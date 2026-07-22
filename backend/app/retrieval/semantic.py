"""Semantic (vector) search.

Single responsibility (NFR-5): embed the query and perform pgvector
cosine-similarity search over chunks (FR-7). No fusion or keyword
logic here.
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
    """Return the top_k semantically nearest chunks to `query` (FR-7).

    TODO: embed query via ingestion.embedding.embed_texts([query]),
    delegate to repositories.chunk_repo.semantic_search.
    """
    raise NotImplementedError
