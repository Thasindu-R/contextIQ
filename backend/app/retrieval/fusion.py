"""Reciprocal Rank Fusion.

Single responsibility (NFR-5): fuse ranked semantic and keyword
result lists into a single ranked list via RRF (FR-14). Pure
computation only — no search execution or DB access here (see
retriever.hybrid_search for the orchestration that calls this).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.retrieval.types import RetrievedChunk

DEFAULT_RRF_K = 60  # matches Settings.rrf_k's default


@dataclass(frozen=True, slots=True)
class FusedChunk:
    """One chunk's fused result, with per-source provenance for the
    Week 3 retrieval debug view.

    semantic_rank/keyword_rank are 1-based positions within whichever
    list the chunk appeared in, or None if it wasn't present there.
    Provenance convention (this system only ever fuses these two
    sources): result_lists[0] passed to reciprocal_rank_fusion is
    treated as the semantic list, result_lists[1] as the keyword list.
    """

    chunk: RetrievedChunk
    fused_score: float
    semantic_rank: int | None
    keyword_rank: int | None


def reciprocal_rank_fusion(
    result_lists: list[list[RetrievedChunk]],
    top_k: int,
    k: int = DEFAULT_RRF_K,
) -> list[FusedChunk]:
    """Combine ranked result lists using RRF: score = sum(1 / (k + rank)).

    rank is each chunk's 1-based position within a given input list.
    Chunks are deduplicated by chunk_id across lists — a chunk present
    in multiple lists accumulates one reciprocal-rank term per list it
    appears in, which is why it naturally outranks a chunk present in
    only one list even when that chunk's single rank is better (e.g.
    two mid-table appearances beat one near-top appearance).

    Note: `top_k` has no default (required), so it's placed before
    `k` (which does) to keep this a valid Python signature.
    """
    fused_scores: dict[uuid.UUID, float] = {}
    chunks_by_id: dict[uuid.UUID, RetrievedChunk] = {}
    semantic_ranks: dict[uuid.UUID, int] = {}
    keyword_ranks: dict[uuid.UUID, int] = {}

    for list_index, result_list in enumerate(result_lists):
        for rank, result in enumerate(result_list, start=1):
            fused_scores[result.chunk_id] = fused_scores.get(result.chunk_id, 0.0) + 1.0 / (
                k + rank
            )
            chunks_by_id.setdefault(result.chunk_id, result)
            if list_index == 0:
                semantic_ranks[result.chunk_id] = rank
            elif list_index == 1:
                keyword_ranks[result.chunk_id] = rank

    fused = [
        FusedChunk(
            chunk=chunks_by_id[chunk_id],
            fused_score=score,
            semantic_rank=semantic_ranks.get(chunk_id),
            keyword_rank=keyword_ranks.get(chunk_id),
        )
        for chunk_id, score in fused_scores.items()
    ]
    fused.sort(key=lambda fc: fc.fused_score, reverse=True)
    return fused[:top_k]
