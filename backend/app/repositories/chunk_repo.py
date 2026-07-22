"""Chunk data-access layer.

Single responsibility (NFR-5): all SQL/ORM access for the `chunks`
table lives here — bulk inserts from ingestion, and the low-level
semantic/keyword query primitives used by the retrieval layer
(FR-7 semantic, FR-13 keyword). No fusion or ranking logic here.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import Chunk


async def bulk_insert(session: AsyncSession, chunks: list[Chunk]) -> None:
    """Persist a batch of chunks (with embeddings) for a document.

    Meant to compose inside a caller-managed `async with
    session.begin()` block alongside document_repo.create, so the
    document row and all its chunks land in one transaction.
    """
    session.add_all(chunks)
    await session.flush()


async def semantic_search(
    session: AsyncSession,
    query_embedding: list[float],
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Cosine-similarity nearest-neighbor search over `embedding` (FR-7).

    TODO: SELECT ... ORDER BY embedding <=> query_embedding LIMIT top_k
    Returns (chunk, similarity_score) pairs.
    """
    raise NotImplementedError


async def keyword_search(
    session: AsyncSession,
    query_text: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Full-text search over `text_search` using tsquery/ts_rank (FR-13).

    TODO: SELECT ... WHERE text_search @@ plainto_tsquery(query_text)
    ORDER BY ts_rank(...) DESC LIMIT top_k
    Returns (chunk, rank_score) pairs.
    """
    raise NotImplementedError
