"""Ingestion pipeline orchestrator.

Single responsibility (NFR-5): the single entry point that turns a
stored file into embedded chunks — extract -> chunk -> embed. Pure
computation only, no DB access: services.document_service owns
persisting the result, in one transaction alongside the document row
(see its module docstring for why ingestion runs synchronously rather
than as a background task).
"""
from __future__ import annotations

from dataclasses import dataclass

from app.ingestion.chunking import TextChunk, chunk_pages
from app.ingestion.embedding import EmbeddingService
from app.ingestion.extraction import ExtractedPage, extract_text


@dataclass
class IngestedChunk:
    """A chunk paired with its embedding, ready to persist."""

    chunk: TextChunk
    embedding: list[float]


async def run(
    file_path: str,
    mime_type: str,
    embedding_service: EmbeddingService,
    chunk_size: int,
    chunk_overlap: int,
) -> tuple[list[ExtractedPage], list[IngestedChunk]]:
    """Extract -> chunk -> embed a stored file (FR-2, FR-3, FR-4).

    Returns the extracted pages (callers use this for page_count) and
    the embedded chunks ready to persist. Raises whatever
    extraction.extract_text raises — UnsupportedFileType,
    CorruptDocumentError, EncryptedDocumentError, EmptyDocumentError —
    unchanged, so callers can map them to HTTP responses (see
    app.main's exception handlers).
    """
    pages = extract_text(file_path, mime_type)
    text_chunks = chunk_pages(pages, chunk_size, chunk_overlap)
    vectors = await embedding_service.embed_texts_async([c.text for c in text_chunks])
    ingested_chunks = [
        IngestedChunk(chunk=text_chunk, embedding=vector)
        for text_chunk, vector in zip(text_chunks, vectors, strict=True)
    ]
    return pages, ingested_chunks
