"""Evaluation harness.

Single responsibility (NFR-5): run the fixed eval_set.json Q&A pairs
against the fixed document collection under evaluation/documents/,
once per retrieval mode (semantic-only / keyword-only / hybrid, via
retrieval.retriever using retrieval.modes.RetrievalMode), and report
retrieval accuracy + answer correctness per mode (FR-12, FR-15, Ch. 9).
"""
from __future__ import annotations

from app.retrieval.modes import RetrievalMode


def run_evaluation(mode: RetrievalMode) -> dict:
    """Run the eval set for a single retrieval mode and return metrics.

    TODO: load eval_set.json, for each pair run retrieval.retriever.retrieve
    and services.qa_service.answer_query with the given mode, score via
    evaluation.metrics, aggregate results.
    """
    raise NotImplementedError


def main() -> None:
    """Run evaluation across all three modes and print a comparison table.

    TODO: for mode in RetrievalMode: run_evaluation(mode); print summary
    table matching the README's retrieval-mode accuracy comparison (Ch. 9).
    """
    raise NotImplementedError


if __name__ == "__main__":
    main()
