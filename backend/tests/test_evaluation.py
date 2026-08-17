"""Tests for the evaluation harness.

Single responsibility (NFR-5): verify the scoring functions, the
per-mode aggregation, and the corpus/ground-truth loading that
evaluation/run_eval.py reports from (FR-12, FR-15).

Almost everything here is pure: metrics and aggregation need neither a
database nor a Claude key, which is the point -- a harness whose own
correctness could only be checked by running it against Postgres and
paying for generation would never be checked. The two exceptions are
the shipped-eval-set validation (reads the repo's own files) and the
ground-truth resolution test at the bottom, which needs a real ingest.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.core.exceptions import UpstreamAPIError
from app.ingestion.embedding import load_model
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk, RetrievedChunk
from evaluation import corpus, metrics, run_eval
from evaluation.corpus import EvalPair, EvalSetError
from evaluation.report import ModeReport, PairResult, render_summary, to_json

# --- scoring: retrieval -----------------------------------------------------


def test_top_k_hit_is_true_when_any_expected_chunk_was_retrieved():
    assert metrics.retrieval_top_k_hit(["a", "b", "c"], ["c", "z"]) is True


def test_top_k_hit_is_false_when_none_was_retrieved():
    assert metrics.retrieval_top_k_hit(["a", "b"], ["z"]) is False


def test_top_k_hit_is_false_for_an_empty_expectation():
    """The FR-10 pairs have no ground truth, and must not score a free
    hit that would inflate every mode's rate identically."""
    assert metrics.retrieval_top_k_hit(["a", "b"], []) is False


def test_recall_counts_the_share_of_expected_chunks_found():
    assert metrics.recall_at_k(["a", "b"], ["a", "b", "c", "d"]) == 0.5
    assert metrics.recall_at_k(["a", "b"], ["a", "b"]) == 1.0
    assert metrics.recall_at_k([], ["a"]) == 0.0
    assert metrics.recall_at_k(["a"], []) == 0.0


def test_first_relevant_rank_is_one_based_and_none_on_a_miss():
    assert metrics.first_relevant_rank(["a", "b", "c"], ["b"]) == 2
    assert metrics.first_relevant_rank(["a", "b"], ["z"]) is None
    assert metrics.first_relevant_rank(["a"], []) is None


def test_reciprocal_rank_rewards_an_earlier_hit():
    assert metrics.reciprocal_rank(["a", "b", "c"], ["a"]) == 1.0
    assert metrics.reciprocal_rank(["a", "b", "c"], ["c"]) == pytest.approx(1 / 3)
    assert metrics.reciprocal_rank(["a", "b"], ["z"]) == 0.0


# --- scoring: answers -------------------------------------------------------


def test_normalize_answer_folds_case_punctuation_and_articles():
    assert metrics.normalize_answer("The notice period is 14 days!") == "notice period is 14 days"


def test_token_f1_is_one_for_a_match_and_zero_for_no_overlap():
    assert metrics.token_f1("14 calendar days", "14 calendar days") == 1.0
    assert metrics.token_f1("blackcurrant and bergamot", "48 volts") == 0.0


def test_token_f1_penalises_padding_around_a_correct_answer():
    terse = metrics.token_f1("22 minutes", "22 minutes")
    padded = metrics.token_f1(
        "Based on the specification I was given, the answer is 22 minutes.", "22 minutes"
    )
    assert padded < terse


def test_fact_coverage_finds_facts_inside_a_longer_answer():
    answer = "The coefficient is -0.35 percent per degree Celsius above 25 degrees."
    assert metrics.fact_coverage(answer, ["-0.35"]) == 1.0
    assert metrics.fact_coverage(answer, ["-0.35", "0.5 percent"]) == 0.5
    assert metrics.fact_coverage(answer, []) == 1.0


def test_fact_coverage_catches_a_fluent_answer_with_the_wrong_number():
    """The case token F1 cannot see: right passage, wrong figure."""
    expected = "Opportunity charging takes 22 minutes from 20 to 80 percent."
    wrong = "Opportunity charging takes 45 minutes from 20 to 80 percent."
    assert metrics.token_f1(wrong, expected) > 0.8
    assert metrics.fact_coverage(wrong, ["22 minutes"]) == 0.0


def test_is_refusal_detects_the_fr10_sentence_even_when_wrapped():
    assert metrics.is_refusal("I cannot answer this question based on the available documents.")
    assert metrics.is_refusal(
        "I cannot answer this question based on the available documents, sorry."
    )
    assert not metrics.is_refusal("The notice period is 14 calendar days.")


def test_mean_of_nothing_is_zero():
    assert metrics.mean([]) == 0.0


# --- aggregation ------------------------------------------------------------


def _result(
    pair_id: str,
    kind: str,
    rank: int | None,
    answerable: bool = True,
    **kwargs,
) -> PairResult:
    return PairResult(
        pair_id=pair_id,
        kind=kind,
        question=f"question {pair_id}",
        answerable=answerable,
        retrieved_chunk_ids=[],
        hit=rank is not None,
        recall=1.0 if rank is not None else 0.0,
        reciprocal_rank=1.0 / rank if rank is not None else 0.0,
        retrieval_ms=1.0,
        first_relevant_rank=rank,
        **kwargs,
    )


def _report() -> ModeReport:
    return ModeReport(
        mode="hybrid",
        results=[
            _result("q1", "lexical", 1),
            _result("q2", "paraphrase", 3),
            _result("q3", "paraphrase", None),
            _result("q4", "unanswerable", None, answerable=False),
        ],
    )


def test_hit_rate_ignores_unanswerable_pairs():
    """3 answerable pairs, 2 hit -> 2/3, not 2/4."""
    assert _report().hit_rate == pytest.approx(2 / 3)


def test_hit_rate_at_cutoff_reads_off_the_first_relevant_rank():
    report = _report()
    assert report.hit_rate_at(1) == pytest.approx(1 / 3)
    assert report.hit_rate_at(3) == pytest.approx(2 / 3)


def test_mrr_by_kind_is_none_for_a_kind_with_no_ground_truth():
    report = _report()
    assert report.mrr_for_kind("lexical") == 1.0
    assert report.mrr_for_kind("paraphrase") == pytest.approx((1 / 3 + 0.0) / 2)
    assert report.mrr_for_kind("unanswerable") is None
    assert report.mrr_for_kind("mixed") is None


def test_p95_latency_takes_the_tail_not_the_mean():
    """Nearest-rank: with 20 samples the 95th percentile is the 19th,
    so two slow queries move it and one does not."""
    report = ModeReport(
        mode="semantic",
        results=[_result(f"q{i}", "lexical", 1) for i in range(20)],
    )
    report.results[-1].retrieval_ms = 100.0
    assert report.p95_latency_ms == 1.0

    report.results[-2].retrieval_ms = 100.0
    assert report.mean_latency_ms < 20.0
    assert report.p95_latency_ms == 100.0


def test_refusal_accuracy_counts_both_directions():
    report = ModeReport(
        mode="hybrid",
        results=[
            # Answered an answerable question: correct.
            _result("q1", "lexical", 1, answer="14 days", refused=False),
            # Refused an answerable question: wrong.
            _result("q2", "lexical", 1, answer="I cannot", refused=True),
            # Refused an unanswerable question: correct.
            _result("q3", "unanswerable", None, answerable=False, answer="I cannot", refused=True),
            # Answered an unanswerable question: wrong.
            _result("q4", "unanswerable", None, answerable=False, answer="$40k", refused=False),
        ],
    )
    assert report.refusal_accuracy == 0.5


def test_render_summary_labels_the_hit_column_with_the_real_top_k():
    rendered = render_summary([_report()], top_k=7, with_answers=False)
    assert "hit@7" in rendered
    assert "hybrid" in rendered
    # No answers were generated, so no answer-quality table.
    assert "token F1" not in rendered


def test_to_json_round_trips_every_result():
    payload = json.loads(to_json([_report()], top_k=5))
    assert payload["top_k"] == 5
    assert len(payload["modes"][0]["results"]) == 4
    assert payload["modes"][0]["mrr_by_kind"].keys() == {"lexical", "paraphrase"}


# --- generation leg ---------------------------------------------------------


def test_placeholder_key_is_recognised():
    """The harness degrades to retrieval-only rather than firing 60
    doomed requests and reporting zeroes as a measurement."""
    assert run_eval._is_placeholder_key("sk-ant-placeholder-replace-me")
    assert run_eval._is_placeholder_key("sk-ant-ci-placeholder")
    assert not run_eval._is_placeholder_key("sk-ant-api03-Zr7Kx")


def _ranked(text: str = "The notice period is 14 calendar days.") -> RankedChunk:
    return RankedChunk(
        chunk=RetrievedChunk(
            chunk_id=uuid.uuid4(),
            document_id=uuid.uuid4(),
            filename="employee_leave_policy.txt",
            page_number=1,
            text=text,
            score=0.1,
        ),
        score=0.1,
        semantic_rank=1,
        keyword_rank=None,
    )


async def test_generate_answer_concatenates_the_streamed_tokens(mock_claude_client):
    answer, error = await run_eval._generate_answer(
        "How much notice?", RetrievalMode.HYBRID, [_ranked()]
    )
    assert answer == mock_claude_client
    assert error is None


async def test_generate_answer_reports_an_error_frame_without_raising(monkeypatch):
    """One upstream failure costs one pair, not the whole run."""

    async def _failing_stream(prompt: str):
        raise UpstreamAPIError("Claude API call failed: boom")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr("app.generation.claude_client.stream", _failing_stream)

    answer, error = await run_eval._generate_answer(
        "How much notice?", RetrievalMode.HYBRID, [_ranked()]
    )
    assert answer == ""
    assert "boom" in error


async def test_generate_answer_returns_the_fr10_refusal_for_empty_retrieval():
    """No chunks is a completed answer, not a generation error -- and
    it must reach the harness as the refusal sentence so
    refusal_accuracy can score it."""
    answer, error = await run_eval._generate_answer("Anything?", RetrievalMode.HYBRID, [])
    assert error is None
    assert metrics.is_refusal(answer)


# --- eval set and corpus ----------------------------------------------------


def test_shipped_eval_set_locators_all_appear_in_their_document():
    """Guards the eval set against the corpus drifting away from it.

    Without this, an edited corpus turns into ground truth that
    resolves to nothing, which deflates every mode by the same amount
    and reads as a retrieval regression rather than a broken fixture.
    """
    pairs = corpus.load_eval_set()
    documents = {path.name: path.read_text(encoding="utf-8") for path in corpus.corpus_files()}

    for pair in pairs:
        if not pair.is_answerable:
            continue
        assert pair.document in documents, f"{pair.id} names a document not in the corpus"
        for locator in pair.locators:
            assert locator in documents[pair.document], f"{pair.id}: {locator!r} not found"


def test_shipped_eval_set_covers_every_question_kind():
    kinds = {pair.kind for pair in corpus.load_eval_set()}
    assert kinds == {"lexical", "paraphrase", "mixed", "unanswerable"}


def _write_eval_set(tmp_path: Path, pair: dict) -> Path:
    path = tmp_path / "eval_set.json"
    path.write_text(json.dumps({"qa_pairs": [pair]}), encoding="utf-8")
    return path


def test_load_eval_set_rejects_an_answerable_pair_with_no_locators(tmp_path):
    path = _write_eval_set(
        tmp_path,
        {
            "id": "q1",
            "kind": "lexical",
            "question": "?",
            "document": "a.txt",
            "locators": [],
            "expected_answer": "x",
            "required_facts": [],
        },
    )
    with pytest.raises(EvalSetError, match="no locators"):
        corpus.load_eval_set(path)


def test_load_eval_set_rejects_duplicate_ids(tmp_path):
    path = tmp_path / "eval_set.json"
    pair = {
        "id": "q1",
        "kind": "unanswerable",
        "question": "?",
        "document": None,
        "locators": [],
        "expected_answer": "x",
        "required_facts": [],
    }
    path.write_text(json.dumps({"qa_pairs": [pair, dict(pair)]}), encoding="utf-8")
    with pytest.raises(EvalSetError, match="Duplicate"):
        corpus.load_eval_set(path)


def test_load_eval_set_rejects_an_empty_set(tmp_path):
    path = tmp_path / "eval_set.json"
    path.write_text(json.dumps({"qa_pairs": []}), encoding="utf-8")
    with pytest.raises(EvalSetError, match="no Q&A pairs"):
        corpus.load_eval_set(path)


def test_corpus_files_rejects_an_empty_directory(tmp_path):
    with pytest.raises(EvalSetError, match="No .txt or .pdf"):
        corpus.corpus_files(tmp_path)


# --- ground truth against a real ingest -------------------------------------


@pytest.fixture(scope="module")
def embedding_service():
    """The real model, loaded once -- ground truth has to be resolved
    against chunks that were embedded the way ingestion embeds them."""
    return load_model("all-MiniLM-L6-v2")


async def test_resolve_ground_truth_maps_locators_onto_real_chunk_ids(
    db_session, embedding_service, tmp_path
):
    document = tmp_path / "tiny_corpus.txt"
    document.write_text(
        "The escalation window is 10 working days.\nFault E-114 is a marker halt.\n",
        encoding="utf-8",
    )

    document_ids, ingested = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path
    )
    assert ingested is True
    assert set(document_ids) == {"tiny_corpus.txt"}

    pairs = [
        EvalPair(
            id="q1",
            kind="lexical",
            question="What does E-114 mean?",
            document="tiny_corpus.txt",
            locators=["Fault E-114 is a marker halt"],
            expected_answer="A marker halt.",
            required_facts=[],
        )
    ]
    await corpus.resolve_ground_truth(db_session, pairs, document_ids)

    assert pairs[0].expected_chunk_ids
    assert all(uuid.UUID(chunk_id) for chunk_id in pairs[0].expected_chunk_ids)


async def test_resolve_ground_truth_fails_loudly_on_an_unresolvable_locator(
    db_session, embedding_service, tmp_path
):
    document = tmp_path / "tiny_corpus.txt"
    document.write_text("Nothing relevant here.\n", encoding="utf-8")

    document_ids, _ = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path
    )
    pairs = [
        EvalPair(
            id="q1",
            kind="lexical",
            question="?",
            document="tiny_corpus.txt",
            locators=["a phrase that is not in the document"],
            expected_answer="x",
            required_facts=[],
        )
    ]

    with pytest.raises(EvalSetError, match="matched no chunk"):
        await corpus.resolve_ground_truth(db_session, pairs, document_ids)


async def test_run_evaluation_scores_retrieval_and_answers_end_to_end(
    db_session, embedding_service, tmp_path, mock_claude_client
):
    """The whole harness over a one-document corpus: ingest, resolve
    ground truth, retrieve in every mode, generate, score.

    Claude is mocked, so the answer numbers are meaningless -- what
    this pins down is that the answer columns are populated at all and
    that every mode produces one result per pair.
    """
    (tmp_path / "tiny_corpus.txt").write_text(
        "The escalation window is 10 working days.\n", encoding="utf-8"
    )
    document_ids, _ = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path
    )
    pairs = [
        EvalPair(
            id="q1",
            kind="lexical",
            question="How long is the escalation window?",
            document="tiny_corpus.txt",
            locators=["escalation window is 10 working days"],
            expected_answer="10 working days.",
            required_facts=["10 working days"],
        ),
        EvalPair(
            id="q2",
            kind="unanswerable",
            question="What is the parental leave entitlement?",
            document=None,
            locators=[],
            expected_answer=metrics.NO_CONTEXT_ANSWER,
            required_facts=[],
        ),
    ]
    await corpus.resolve_ground_truth(db_session, pairs, document_ids)

    modes = [RetrievalMode.SEMANTIC, RetrievalMode.KEYWORD, RetrievalMode.HYBRID]
    reports = await run_eval.run_evaluation(
        db_session,
        embedding_service,
        modes,
        pairs,
        list(document_ids.values()),
        top_k=5,
        with_answers=True,
    )

    assert [report.mode for report in reports] == ["semantic", "keyword", "hybrid"]
    for report in reports:
        assert len(report.results) == len(pairs)
        assert report.generation_errors == 0
        assert len(report.generated) == len(pairs)
        assert report.hit_rate == 1.0, f"{report.mode} missed the only answerable pair"
        assert 0.0 <= report.mean_answer_f1 <= 1.0
        # The mock never refuses, so a mode that retrieves something
        # for the unanswerable pair gets that half wrong. The keyword
        # leg shares no lexeme with it, retrieves nothing, and so emits
        # the genuine FR-10 refusal -- which is the correct answer.
        expected_refusal_accuracy = 1.0 if report.mode == "keyword" else 0.5
        assert report.refusal_accuracy == expected_refusal_accuracy
        assert mock_claude_client in (report.results[0].answer or "")

    rendered = render_summary(reports, top_k=5, with_answers=True)
    assert "token F1" in rendered


async def test_ingest_corpus_reuses_an_already_ingested_corpus(
    db_session, embedding_service, tmp_path
):
    """Reuse is what keeps chunk ids -- and therefore the reported
    numbers -- stable between runs."""
    (tmp_path / "tiny_corpus.txt").write_text("Some content to chunk.\n", encoding="utf-8")

    first, ingested_first = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path
    )
    second, ingested_second = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path
    )

    assert ingested_first is True
    assert ingested_second is False
    assert first == second

    third, ingested_third = await corpus.ingest_corpus(
        db_session, embedding_service, get_settings(), documents_dir=tmp_path, reingest=True
    )
    assert ingested_third is True
    assert third != second
