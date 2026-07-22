"""Document orchestration service.

Single responsibility (NFR-5): sits between the documents API and the
ingestion pipeline / document + chunk repositories. Handles upload
validation, running ingestion (extract -> chunk -> embed), and
persisting the result in one transaction (FR-1..FR-5). No SQL or
file-parsing logic here — that lives in ingestion/ and repositories/.

Ingestion runs synchronously within the request rather than as a
background task: the requirement that any failure roll back
completely and map to a clean 4xx (not a background task's swallowed
exception, since a background task's errors can't turn into an HTTP
response after the client already got one) only holds if extraction,
chunking, embedding, and persistence all happen before the response
is returned. This trades away part of NFR-1's "uploads return
promptly" for NFR-3's "never leave a partially-ingested document" /
"never a 500 stack trace" — for documents under NFR-1's ~200-page
target this is still well within a few seconds.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.exceptions import FileTooLargeError, UnsupportedFileType
from app.ingestion import pipeline
from app.ingestion.embedding import EmbeddingService
from app.ingestion.extraction import PDF_MIME_TYPE, TEXT_MIME_TYPE
from app.models.chunk import Chunk
from app.models.document import Document
from app.repositories import chunk_repo, document_repo
from app.schemas.document import DocumentOut, DocumentStatus

SUPPORTED_MIME_TYPES = {PDF_MIME_TYPE, TEXT_MIME_TYPE}


async def upload_document(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    settings: Settings,
    file_bytes: bytes,
    filename: str,
    mime_type: str,
) -> DocumentOut:
    """Ingest an uploaded document end-to-end (FR-1..FR-5).

    Validates mime type (-> UnsupportedFileType) and size (->
    FileTooLargeError) up front. extract -> chunk -> embed then run
    entirely before any database write; the document and its chunks
    are only ever inserted — in one transaction — once every step has
    succeeded, so a failure anywhere (including an extraction error:
    CorruptDocumentError/EncryptedDocumentError/EmptyDocumentError)
    leaves zero rows in either table. The file written to disk is
    removed on failure too, so nothing orphaned survives a failed
    upload.
    """
    if mime_type not in SUPPORTED_MIME_TYPES:
        raise UnsupportedFileType(f"Unsupported content type: {mime_type!r}")

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise FileTooLargeError(
            f"File {filename!r} is {len(file_bytes)} bytes, exceeding the "
            f"{settings.max_upload_size_mb}MB limit"
        )

    document_id = uuid.uuid4()
    storage_dir = Path(settings.storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_path = storage_dir / f"{document_id}{Path(filename).suffix}"
    storage_path.write_bytes(file_bytes)

    try:
        pages, ingested_chunks = await pipeline.run(
            file_path=str(storage_path),
            mime_type=mime_type,
            embedding_service=embedding_service,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
    except Exception:
        storage_path.unlink(missing_ok=True)
        raise

    document = Document(
        id=document_id,
        filename=filename,
        status=DocumentStatus.READY.value,
        page_count=len(pages),
    )
    chunk_rows = [
        Chunk(
            id=uuid.uuid4(),
            document_id=document_id,
            chunk_index=ingested.chunk.chunk_index,
            content=ingested.chunk.text,
            page_number=ingested.chunk.page,
            embedding=ingested.embedding,
        )
        for ingested in ingested_chunks
    ]

    async with session.begin():
        await document_repo.create(session, document)
        await chunk_repo.bulk_insert(session, chunk_rows)

    return DocumentOut(
        id=document.id,
        filename=document.filename,
        upload_time=document.upload_time,
        status=DocumentStatus(document.status),
        page_count=document.page_count,
    )


async def list_documents(session: AsyncSession) -> list[DocumentOut]:
    """Return all documents (FR-11).

    TODO: delegate to document_repo.list_all and map to DocumentOut.
    """
    raise NotImplementedError


async def delete_document(session: AsyncSession, document_id: uuid.UUID) -> None:
    """Delete a document and its chunks (FR-11).

    TODO: delegate to document_repo.delete; optionally remove stored file.
    """
    raise NotImplementedError
