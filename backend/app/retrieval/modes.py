"""Retrieval mode enumeration.

Single responsibility (NFR-5): define the three retrieval modes
(FR-15) as a single shared enum consumed by both the query API
(schemas.query.QueryRequest) and the evaluation harness
(evaluation/run_eval.py), so both stay in sync with retriever.py.
"""
from __future__ import annotations

from enum import Enum


class RetrievalMode(str, Enum):
    """Which retrieval strategy to use for a query (FR-15)."""

    SEMANTIC = "semantic"
    KEYWORD = "keyword"
    HYBRID = "hybrid"
