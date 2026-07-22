"""Keyword (full-text) search.

Single responsibility (NFR-5): perform PostgreSQL tsvector/tsquery
full-text search over chunks (FR-13). No fusion or semantic logic
here.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import Chunk


async def search(
    session: AsyncSession,
    query: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Return the top_k keyword matches for `query` (FR-13).

    TODO: delegate to repositories.chunk_repo.keyword_search.
    """
    raise NotImplementedError
