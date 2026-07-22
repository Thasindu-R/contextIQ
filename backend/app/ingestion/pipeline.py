"""Ingestion pipeline orchestrator.

Single responsibility (NFR-5): the single entry point the upload flow
calls to turn a stored file into searchable chunks — extract -> chunk
-> embed -> dual-store (embedding + tsvector). Designed to run as a
FastAPI BackgroundTask (or equivalent) so uploads return promptly
(NFR-1). Contains no extraction/chunking/embedding logic itself —
only orchestration.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession


async def run(session: AsyncSession, document_id: uuid.UUID, file_path: str, mime_type: str) -> None:
    """Run the full ingestion pipeline for a single document.

    TODO:
      1. extraction.extract_text(file_path, mime_type) -> pages
      2. chunking.chunk_pages(pages, chunk_size, chunk_overlap) -> chunks
      3. embedding.embed_texts([c.text for c in chunks]) -> vectors
      4. chunk_repo.bulk_insert(session, chunks_with_embeddings)
      5. document_repo.update_status(session, document_id, "ready")
      On failure: document_repo.update_status(session, document_id, "failed")
    """
    raise NotImplementedError
