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
from app.retrieval.types import RetrievedChunk


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
) -> list[RetrievedChunk]:
    """Retrieve the top_k chunks for `query` using the given mode (FR-15).

    Single dispatch point for retrieval mode, shared by the query API
    (services.qa_service) and the evaluation harness. Always returns
    plain RetrievedChunk (never FusedChunk or the ORM Chunk) so callers
    downstream of retrieval (prompt_builder, citation assembly) only
    ever have to deal with one detached, session-independent shape --
    for HYBRID this unwraps FusedChunk.chunk, discarding fusion
    provenance (semantic_rank/keyword_rank) that only the Week 3 debug
    view needs, not generation.
    """
    if mode is RetrievalMode.SEMANTIC:
        return await semantic.search(session, embedding_service, query, top_k, document_ids)
    if mode is RetrievalMode.KEYWORD:
        return await keyword.search(session, query, top_k, document_ids)
    fused = await hybrid_search(session, embedding_service, query, top_k, document_ids)
    return [fc.chunk for fc in fused]
