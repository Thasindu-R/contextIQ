"""Evaluation metrics.

Single responsibility (NFR-5): scoring functions for retrieval
accuracy (top-k hit rate, recall, MRR) and answer correctness, used by
run_eval.py. No orchestration or retrieval logic here.

Every function is pure and deterministic: same inputs, same score, no
database, no network, no model. That is deliberate. A harness whose
metrics call an LLM judge cannot distinguish "retrieval got worse"
from "the judge was in a different mood today", and the entire point
of FR-15 is to compare three retrieval modes against each other. The
cost is that answer scoring is lexical rather than semantic -- see
answer_correctness_score for what that does and does not measure.
"""
from __future__ import annotations

import re
import unicodedata

# The exact sentence the system emits when it has no grounded answer
# (FR-10). Kept in sync with services.qa_service.NO_CONTEXT_ANSWER --
# imported rather than re-typed so the two cannot drift apart.
from app.services.qa_service import NO_CONTEXT_ANSWER

# Stripped before token comparison so "the notice period is 14 days" and
# "notice period: 14 days" don't score as disagreeing about the answer.
_ARTICLES = frozenset({"a", "an", "the"})

_PUNCTUATION = re.compile(r"[^\w\s]")
_WHITESPACE = re.compile(r"\s+")


def normalize_answer(text: str) -> str:
    """Lowercase, strip punctuation/articles, and collapse whitespace.

    The standard SQuAD normalization, which is what makes token_f1
    comparable to published numbers. Unicode is NFKC-folded first so a
    typographic dash or non-breaking space in a model's answer doesn't
    read as a different token from the plain ASCII one in the eval set.
    """
    folded = unicodedata.normalize("NFKC", text).lower()
    without_punctuation = _PUNCTUATION.sub(" ", folded)
    tokens = [t for t in without_punctuation.split() if t not in _ARTICLES]
    return _WHITESPACE.sub(" ", " ".join(tokens)).strip()


def _tokens(text: str) -> list[str]:
    normalized = normalize_answer(text)
    return normalized.split() if normalized else []


def retrieval_top_k_hit(retrieved_chunk_ids: list[str], expected_chunk_ids: list[str]) -> bool:
    """Return True if any expected chunk id appears in the retrieved set.

    The headline retrieval metric: did the mode put *something* usable
    in front of the model? A stricter all-of-them measure would punish
    a mode for the arbitrary place a fixed-size chunk window happened
    to cut a passage in half, which says nothing about the retriever.
    Use recall_at_k when the question is how *much* of the relevant
    material surfaced.

    An empty expectation returns False rather than vacuously True:
    the only pairs with no expected chunks are the FR-10 unanswerable
    ones, and "retrieval hit" is meaningless for those -- run_eval
    scores them on refusal instead, and must not fold a free True into
    the hit rate.
    """
    if not expected_chunk_ids:
        return False
    return bool(set(retrieved_chunk_ids) & set(expected_chunk_ids))


def recall_at_k(retrieved_chunk_ids: list[str], expected_chunk_ids: list[str]) -> float:
    """Fraction of the expected chunks that appear in the retrieved set.

    Returns 0.0 for an empty expectation, for the same reason
    retrieval_top_k_hit returns False.
    """
    if not expected_chunk_ids:
        return 0.0
    expected = set(expected_chunk_ids)
    found = expected & set(retrieved_chunk_ids)
    return len(found) / len(expected)


def first_relevant_rank(
    retrieved_chunk_ids: list[str], expected_chunk_ids: list[str]
) -> int | None:
    """1-based position of the first relevant chunk, or None if absent.

    The primitive behind both MRR and the hit@1/hit@3 columns: one
    retrieval run at top_k answers "would a smaller top_k also have
    worked?", so the cutoffs are read off this rather than re-queried.
    """
    if not expected_chunk_ids:
        return None
    expected = set(expected_chunk_ids)
    for rank, chunk_id in enumerate(retrieved_chunk_ids, start=1):
        if chunk_id in expected:
            return rank
    return None


def reciprocal_rank(retrieved_chunk_ids: list[str], expected_chunk_ids: list[str]) -> float:
    """1/rank of the first relevant chunk, or 0.0 if none was retrieved.

    Averaged over the eval set this is MRR. It is the metric that
    separates two modes with identical hit rates: putting the right
    passage first is worth more than putting it fifth, both because
    the model weights early context more heavily and because a smaller
    top_k would still have worked. On a corpus this size hit@k
    saturates well before MRR does, which is exactly why both are
    reported.
    """
    rank = first_relevant_rank(retrieved_chunk_ids, expected_chunk_ids)
    return 1.0 / rank if rank is not None else 0.0


def token_f1(generated_answer: str, expected_answer: str) -> float:
    """SQuAD-style token-overlap F1 between two answers, in [0, 1].

    Bag-of-tokens with multiplicity, so a model that pads a correct
    answer with three sentences of preamble loses precision rather
    than scoring the same as a terse correct one.
    """
    generated_tokens = _tokens(generated_answer)
    expected_tokens = _tokens(expected_answer)

    if not generated_tokens or not expected_tokens:
        # Both empty is a match; one empty is not.
        return float(generated_tokens == expected_tokens)

    common = 0
    remaining = list(expected_tokens)
    for token in generated_tokens:
        if token in remaining:
            remaining.remove(token)
            common += 1

    if common == 0:
        return 0.0

    precision = common / len(generated_tokens)
    recall = common / len(expected_tokens)
    return 2 * precision * recall / (precision + recall)


def answer_correctness_score(generated_answer: str, expected_answer: str) -> float:
    """Score how well a generated answer matches the expected answer.

    Token F1 against the hand-authored reference (see token_f1). This
    is a *lexical* measure: it rewards an answer that reuses the
    reference's wording and cannot tell a correct paraphrase from a
    wrong answer that borrows the same vocabulary. That is an accepted
    limitation -- fact_coverage is the metric that checks the answer
    actually carries the number or name the question asked for, and
    the two are reported side by side for exactly that reason.
    """
    return token_f1(generated_answer, expected_answer)


def fact_coverage(generated_answer: str, required_facts: list[str]) -> float:
    """Fraction of the required facts that appear in the answer.

    Matching is on the normalized forms, so "-0.35 percent" is found
    inside "-0.35 percent per degree Celsius" but is not defeated by
    casing or punctuation. Returns 1.0 when nothing is required, since
    a pair that demands no specific fact cannot fail this check.

    This is the metric that catches a fluent, plausible, wrong answer:
    token F1 stays respectable when a model rephrases the right
    passage with the wrong number in it, and this does not.
    """
    if not required_facts:
        return 1.0
    normalized_answer = normalize_answer(generated_answer)
    found = sum(1 for fact in required_facts if normalize_answer(fact) in normalized_answer)
    return found / len(required_facts)


def is_refusal(generated_answer: str) -> bool:
    """Return True if the answer is the FR-10 "cannot answer" sentence.

    Substring rather than equality: the refusal reaches the client as
    the whole of an empty-retrieval answer, but when retrieval returns
    irrelevant chunks it is Claude that produces the sentence, and a
    model will sometimes wrap it in a sentence of its own.
    """
    return normalize_answer(NO_CONTEXT_ANSWER) in normalize_answer(generated_answer)


def mean(values: list[float]) -> float:
    """Arithmetic mean, defined as 0.0 for an empty list.

    Aggregation over a category that has no pairs in the eval set
    (say, no unanswerable questions) should report a zero row, not
    raise -- the harness prints every category it knows about.
    """
    return sum(values) / len(values) if values else 0.0
