"""Keyword (full-text) search.

Single responsibility (NFR-5): perform PostgreSQL tsvector/tsquery
full-text search over chunks (FR-13). No fusion or semantic logic
here.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import chunk_repo
from app.retrieval.types import RetrievedChunk


async def search(
    session: AsyncSession,
    query: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    """Return the top_k keyword matches for `query` (FR-13).

    score is ts_rank_cd (higher is more relevant) -- the opposite
    direction from semantic.search's cosine distance (lower is more
    similar). An empty/whitespace-only query returns an empty list
    rather than hitting the database with a query guaranteed to match
    nothing.
    """
    if not query or not query.strip():
        return []

    rows = await chunk_repo.keyword_search(session, query, top_k, document_ids)
    return [
        RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            filename=chunk.document.filename,
            page_number=chunk.page_number,
            text=chunk.content,
            score=rank,
        )
        for chunk, rank in rows
    ]
