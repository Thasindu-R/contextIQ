"""Retrieval orchestrator.

Single responsibility (NFR-5): the single switch point for FR-15 —
dispatches to semantic-only, keyword-only, or hybrid (parallel
semantic + keyword search fused via RRF) retrieval based on
RetrievalMode. Used by both the query API (services.qa_service) and
the evaluation harness (evaluation/run_eval.py) so both exercise
identical retrieval behavior.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import Chunk
from app.retrieval.modes import RetrievalMode


async def retrieve(
    session: AsyncSession,
    query: str,
    mode: RetrievalMode,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Retrieve the top_k chunks for `query` using the given mode (FR-15).

    TODO:
      - RetrievalMode.SEMANTIC -> retrieval.semantic.search
      - RetrievalMode.KEYWORD  -> retrieval.keyword.search
      - RetrievalMode.HYBRID   -> run semantic.search and keyword.search
        concurrently (e.g. asyncio.gather), fuse via
        retrieval.fusion.reciprocal_rank_fusion
    """
    raise NotImplementedError
