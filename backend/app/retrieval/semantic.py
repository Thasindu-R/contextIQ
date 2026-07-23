"""Semantic (vector) search.

Single responsibility (NFR-5): embed the query and perform pgvector
cosine-similarity search over chunks (FR-7). No fusion or keyword
logic here.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.embedding import EmbeddingService
from app.repositories import chunk_repo
from app.retrieval.types import RetrievedChunk


async def search(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    query: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    """Return the top_k semantically nearest chunks to `query` (FR-7).

    `embedding_service` must be the app-lifetime instance loaded once
    at startup (see app.main's lifespan / api.deps.get_embedding_service)
    so the query is embedded with the exact same model/dimension used
    during ingestion — never construct a second SentenceTransformer here.

    score is raw cosine distance from pgvector's `<=>` operator (lower
    is more similar), not a normalized similarity — callers that need
    a "higher is better" ordering should invert it themselves.
    """
    [query_embedding] = await embedding_service.embed_texts_async([query])
    rows = await chunk_repo.semantic_search(session, query_embedding, top_k, document_ids)
    return [
        RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            filename=chunk.document.filename,
            page_number=chunk.page_number,
            text=chunk.content,
            score=distance,
        )
        for chunk, distance in rows
    ]
