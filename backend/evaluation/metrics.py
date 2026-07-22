"""Evaluation metrics.

Single responsibility (NFR-5): scoring functions for retrieval
accuracy (top-k hit rate) and answer correctness, used by run_eval.py.
No orchestration or retrieval logic here.
"""
from __future__ import annotations


def retrieval_top_k_hit(retrieved_chunk_ids: list[str], expected_chunk_ids: list[str]) -> bool:
    """Return True if any expected chunk id appears in the retrieved set.

    TODO: implement set-intersection check.
    """
    raise NotImplementedError


def answer_correctness_score(generated_answer: str, expected_answer: str) -> float:
    """Score how well a generated answer matches the expected answer.

    TODO: implement a similarity/correctness scoring heuristic
    (e.g. exact-match, ROUGE, or LLM-judged score).
    """
    raise NotImplementedError
