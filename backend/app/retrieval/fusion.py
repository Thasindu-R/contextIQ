"""Reciprocal Rank Fusion.

Single responsibility (NFR-5): fuse ranked semantic and keyword
result lists into a single ranked list via RRF (FR-14). No search
execution logic here.
"""
from __future__ import annotations

import uuid

from app.models.chunk import Chunk

DEFAULT_RRF_K = 60


def reciprocal_rank_fusion(
    semantic_results: list[tuple[Chunk, float]],
    keyword_results: list[tuple[Chunk, float]],
    k: int = DEFAULT_RRF_K,
) -> list[tuple[Chunk, float]]:
    """Combine two ranked result lists using RRF: score = sum(1 / (k + rank)).

    TODO: rank each input list, sum reciprocal-rank contributions per
    chunk id (deduping chunks present in both lists), sort descending
    by fused score, return (chunk, fused_score) pairs.
    """
    raise NotImplementedError
