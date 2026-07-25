"""Retrieval orchestrator.

Single responsibility (NFR-5): the single switch point for FR-15 —
dispatches to semantic-only, keyword-only, or hybrid (parallel
semantic + keyword search fused via RRF) retrieval based on
RetrievalMode. Used by both the query API (services.qa_service) and
the evaluation harness (evaluation/run_eval.py) so both exercise
identical retrieval behavior.
"""
from __future__ import annotations

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.embedding import EmbeddingService
from app.retrieval import keyword, semantic
from app.retrieval.fusion import DEFAULT_RRF_K, FusedChunk, reciprocal_rank_fusion
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk


async def hybrid_search(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    query: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
    k: int = DEFAULT_RRF_K,
) -> list[FusedChunk]:
    """Run semantic and keyword search concurrently, fuse via RRF (FR-14, FR-15).

    Each source is queried for `top_k` candidates -- the same figure
    ultimately returned after fusion, so a chunk ranked just outside
    top_k in one list but well-placed in the other can still surface,
    since reciprocal_rank_fusion truncates the *fused* list, not each
    input list, down to top_k.

    asyncio.gather runs both searches concurrently rather than one
    after the other: total latency is close to max(semantic, keyword)
    instead of their sum, which is what keeps hybrid within NFR-10's
    budget -- whichever of the two search backends is slower (usually
    semantic, dominated by query embedding) sets hybrid's cost. Fusion
    itself is in-memory dict/sort work over at most 2 * top_k rows and
    is negligible by comparison.
    """
    semantic_results, keyword_results = await asyncio.gather(
        semantic.search(session, embedding_service, query, top_k, document_ids),
        keyword.search(session, query, top_k, document_ids),
    )
    return reciprocal_rank_fusion([semantic_results, keyword_results], top_k, k=k)


async def retrieve(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    query: str,
    mode: RetrievalMode,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RankedChunk]:
    """Retrieve the top_k chunks for `query` using the given mode (FR-15).

    Single dispatch point for retrieval mode, shared by the query API
    (services.qa_service) and the evaluation harness. Always returns
    RankedChunk (never FusedChunk or the ORM Chunk) so callers
    downstream of retrieval deal with one detached, session-independent
    shape whichever mode ran.

    Every mode reports provenance, not just HYBRID: the retrieval debug
    view (FR-15) has to explain *why* a chunk surfaced, which means
    carrying each chunk's per-leg rank all the way out to the API.
    Single-leg modes set the one rank that applies and leave the other
    None, which is what makes RankedChunk.source come out as
    "semantic"/"keyword" for them and "both" for a chunk that placed in
    both legs of a hybrid search.

    Note the HYBRID score: it's FusedChunk.fused_score, the RRF score
    fusion actually ranked by -- not the wrapped chunk's own `.score`,
    which is the raw per-leg score of whichever leg happened to see the
    chunk first and is therefore meaningless as a hybrid ranking.
    """
    if mode is RetrievalMode.SEMANTIC:
        results = await semantic.search(session, embedding_service, query, top_k, document_ids)
        return [
            RankedChunk(chunk=chunk, score=chunk.score, semantic_rank=rank, keyword_rank=None)
            for rank, chunk in enumerate(results, start=1)
        ]
    if mode is RetrievalMode.KEYWORD:
        results = await keyword.search(session, query, top_k, document_ids)
        return [
            RankedChunk(chunk=chunk, score=chunk.score, semantic_rank=None, keyword_rank=rank)
            for rank, chunk in enumerate(results, start=1)
        ]
    fused = await hybrid_search(session, embedding_service, query, top_k, document_ids)
    return [
        RankedChunk(
            chunk=fc.chunk,
            score=fc.fused_score,
            semantic_rank=fc.semantic_rank,
            keyword_rank=fc.keyword_rank,
        )
        for fc in fused
    ]
