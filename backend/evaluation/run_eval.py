"""Evaluation harness.

Single responsibility (NFR-5): run the fixed eval_set.json Q&A pairs
against the fixed document collection under evaluation/documents/,
once per retrieval mode (semantic-only / keyword-only / hybrid, via
retrieval.retriever using retrieval.modes.RetrievalMode), and report
retrieval accuracy + answer correctness per mode (FR-12, FR-15, Ch. 9).

It deliberately goes through the same modules the API does --
services.document_service to ingest, retrieval.retriever to retrieve,
services.qa_service to answer -- so a number produced here describes
the shipped system rather than a parallel implementation of it.

Usage (from backend/, with DATABASE_URL pointing at a migrated
Postgres+pgvector database):

    make eval                       # retrieval + answers if a key is configured
    python -m evaluation.run_eval --retrieval-only
    python -m evaluation.run_eval --top-k 10 --verbose --json results.json
    python -m evaluation.run_eval --reingest    # after editing the corpus

The corpus is ingested on first run and reused afterwards, for
reproducibility rather than speed (see corpus.ingest_corpus).
Retrieval is scoped to the corpus document ids, so anything else in the
database neither helps nor pollutes the results.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_engine, get_session_factory
from app.ingestion.embedding import EmbeddingService, load_model
from app.retrieval import retriever
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk
from app.schemas.query import DoneFrame, ErrorFrame, TokenFrame
from app.services import qa_service
from evaluation import corpus, metrics, report
from evaluation.corpus import EvalPair, EvalSetError
from evaluation.report import ModeReport, PairResult


def _is_placeholder_key(api_key: str) -> bool:
    """Detect the shipped placeholder key from .env.example.

    Answer scoring needs a real key. Rather than firing 60-odd
    doomed requests and reporting a table of zeroes as if generation
    had been measured and found wanting, the harness notices the
    placeholder up front and runs retrieval-only with a clear notice
    (NFR-3).
    """
    return "placeholder" in api_key.lower()


async def _generate_answer(
    question: str,
    mode: RetrievalMode,
    ranked: list[RankedChunk],
) -> tuple[str, str | None]:
    """Answer over already-retrieved context, returning (answer, error).

    Consumes qa_service.stream_answer -- the exact generator the
    /query route streams to the browser -- and concatenates its token
    frames, so the evaluated answer is the answer a user would have
    seen. A terminal error frame is returned rather than raised: one
    upstream failure should cost one pair, not the whole run.
    """
    parts: list[str] = []
    async for frame in qa_service.stream_answer(question, mode, ranked):
        if isinstance(frame, TokenFrame):
            parts.append(frame.text)
        elif isinstance(frame, ErrorFrame):
            return "".join(parts), frame.message
        elif isinstance(frame, DoneFrame):
            break
    return "".join(parts), None


async def _evaluate_pair(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    pair: EvalPair,
    mode: RetrievalMode,
    document_ids: list[uuid.UUID],
    top_k: int,
    with_answers: bool,
) -> PairResult:
    """Retrieve (and optionally answer) one pair under one mode."""
    started = time.perf_counter()
    ranked = await retriever.retrieve(
        session,
        embedding_service,
        pair.question,
        mode,
        top_k,
        document_ids,
    )
    retrieval_ms = (time.perf_counter() - started) * 1000

    retrieved_ids = [str(rc.chunk.chunk_id) for rc in ranked]
    result = PairResult(
        pair_id=pair.id,
        kind=pair.kind,
        question=pair.question,
        answerable=pair.is_answerable,
        retrieved_chunk_ids=retrieved_ids,
        hit=metrics.retrieval_top_k_hit(retrieved_ids, pair.expected_chunk_ids),
        recall=metrics.recall_at_k(retrieved_ids, pair.expected_chunk_ids),
        reciprocal_rank=metrics.reciprocal_rank(retrieved_ids, pair.expected_chunk_ids),
        retrieval_ms=retrieval_ms,
        first_relevant_rank=metrics.first_relevant_rank(retrieved_ids, pair.expected_chunk_ids),
    )

    if not with_answers:
        return result

    answer, error = await _generate_answer(pair.question, mode, ranked)
    result.answer = answer
    result.generation_error = error
    result.answer_f1 = metrics.answer_correctness_score(answer, pair.expected_answer)
    result.fact_coverage = metrics.fact_coverage(answer, pair.required_facts)
    result.refused = metrics.is_refusal(answer)
    return result


WARM_UP_QUERIES = 3


async def warm_up(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    modes: list[RetrievalMode],
    pairs: list[EvalPair],
    document_ids: list[uuid.UUID],
    top_k: int,
) -> None:
    """Run unscored queries so the latency column measures the mode.

    Without this the first mode evaluated absorbs the
    sentence-transformer's first forward pass, the connection pool's
    first connection, and a cold page cache -- tens of milliseconds
    that belong to the loop order rather than to the retrieval
    strategy. Measured on this corpus the effect was large enough to
    invert the ranking: whichever mode ran first looked slowest,
    including hybrid appearing *faster* than the semantic leg it
    contains, which cannot be true.
    """
    for mode in modes:
        for pair in pairs[:WARM_UP_QUERIES]:
            await retriever.retrieve(
                session, embedding_service, pair.question, mode, top_k, document_ids
            )


async def run_evaluation(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    modes: list[RetrievalMode],
    pairs: list[EvalPair],
    document_ids: list[uuid.UUID],
    top_k: int,
    with_answers: bool,
) -> list[ModeReport]:
    """Run the eval set across the given modes, one report per mode (FR-15).

    The loops are nested pair-outer/mode-inner, and the mode order
    rotates by one on each pair. Both are there to keep the latency
    column honest, and neither was optional:

    - Running each mode as a consecutive block made whichever mode
      went first look ~2ms per query slower, even after a full warm-up
      sweep -- enough to show hybrid beating the semantic leg it
      contains, which cannot be true.
    - Interleaving without rotating just moved the penalty: semantic
      and hybrid embed the *same* question text, so whichever ran
      first for a given pair paid for the cold cache and the other
      read a warm one. Rotating makes each mode first for its share of
      the questions.

    Queries run sequentially, never gathered: the latency column is
    meant to be what one query costs, and concurrent queries would
    measure contention instead.
    """
    await warm_up(session, embedding_service, modes, pairs, document_ids, top_k)

    reports = {mode: ModeReport(mode=str(mode)) for mode in modes}
    for offset, pair in enumerate(pairs):
        rotated = modes[offset % len(modes) :] + modes[: offset % len(modes)]
        for mode in rotated:
            reports[mode].results.append(
                await _evaluate_pair(
                    session,
                    embedding_service,
                    pair,
                    mode,
                    document_ids,
                    top_k,
                    with_answers,
                )
            )
    return [reports[mode] for mode in modes]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m evaluation.run_eval",
        description="Compare semantic, keyword, and hybrid retrieval on the fixed eval set.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=None,
        help="Chunks to retrieve per query (default: Settings.top_k).",
    )
    parser.add_argument(
        "--retrieval-only",
        action="store_true",
        help="Skip generation. No Claude calls, no answer-quality table.",
    )
    parser.add_argument(
        "--modes",
        nargs="+",
        choices=[m.value for m in RetrievalMode],
        default=[m.value for m in RetrievalMode],
        help="Which retrieval modes to evaluate (default: all three).",
    )
    parser.add_argument(
        "--reingest",
        action="store_true",
        help="Re-ingest the corpus even if it is already stored. Use after editing it.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Also print the per-question rank grid.",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        help="Write the full results to this path as JSON.",
    )
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace, settings: Settings) -> int:
    top_k = args.top_k if args.top_k is not None else settings.top_k
    with_answers = not args.retrieval_only

    if with_answers and _is_placeholder_key(settings.claude_api_key):
        print(
            "CLAUDE_API_KEY is still the placeholder, so answer quality cannot be "
            "measured; running retrieval-only. Set a real key to score answers.",
            file=sys.stderr,
        )
        with_answers = False

    pairs = corpus.load_eval_set()

    print(f"Loading embedding model {settings.embedding_model!r}...", file=sys.stderr)
    embedding_service = load_model(settings.embedding_model)

    session_factory = get_session_factory()
    try:
        async with session_factory() as session:
            document_ids, ingested = await corpus.ingest_corpus(
                session, embedding_service, settings, reingest=args.reingest
            )
            print(
                "Ingested the evaluation corpus."
                if ingested
                else "Reusing the already-ingested corpus (--reingest to replace it).",
                file=sys.stderr,
            )
            await corpus.resolve_ground_truth(session, pairs, document_ids)

            corpus_ids = list(document_ids.values())
            modes = [RetrievalMode(value) for value in args.modes]

            print(f"Evaluating {', '.join(str(m) for m in modes)}...", file=sys.stderr)
            reports = await run_evaluation(
                session,
                embedding_service,
                modes,
                pairs,
                corpus_ids,
                top_k,
                with_answers,
            )
    finally:
        await get_engine().dispose()

    print(report.render_summary(reports, top_k, with_answers))
    if args.verbose:
        print(report.render_per_question(reports))

    if args.json is not None:
        args.json.write_text(report.to_json(reports, top_k), encoding="utf-8")
        print(f"Wrote {args.json}", file=sys.stderr)

    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the evaluation across the requested modes and print the tables.

    Returns a process exit code: 0 on success, 1 when the eval set and
    the corpus disagree (EvalSetError), which is a fixable authoring
    error rather than a crash worth a traceback.
    """
    args = _parse_args(argv)
    settings = get_settings()
    try:
        return asyncio.run(_run(args, settings))
    except EvalSetError as exc:
        print(f"Evaluation set error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
