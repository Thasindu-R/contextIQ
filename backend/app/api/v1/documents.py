"""Documents API routes.

Single responsibility (NFR-5): HTTP routing/validation only for
document upload (FR-1) and list/delete (FR-11). Delegates all logic
to services.document_service — no SQL or file parsing here.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_app_settings, get_db, get_embedding_service
from app.core.config import Settings
from app.ingestion.embedding import EmbeddingService
from app.schemas.document import DocumentOut
from app.services import document_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=list[DocumentOut], status_code=201)
async def upload_document(
    files: list[UploadFile],
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
) -> list[DocumentOut]:
    """Upload one or more documents for ingestion (FR-1).

    All routing/validation-adjacent work (mime type, size, extraction,
    4xx mapping) lives in services.document_service /
    core.exceptions — this just wires the request to it. Files are
    ingested one at a time, each in its own storage write + DB
    transaction (see services.document_service.upload_document) -- a
    failure on one file leaves every already-ingested file in the batch
    committed, and aborts the request (with that file's 4xx) before any
    later file in the batch is attempted.
    """
    results = []
    for file in files:
        file_bytes = await file.read()
        results.append(
            await document_service.upload_document(
                session=session,
                embedding_service=embedding_service,
                settings=settings,
                file_bytes=file_bytes,
                filename=file.filename or "unnamed",
                mime_type=file.content_type or "application/octet-stream",
            )
        )
    return results


@router.get("", response_model=list[DocumentOut])
async def list_documents(session: AsyncSession = Depends(get_db)) -> list[DocumentOut]:
    """List all uploaded documents (FR-11)."""
    return await document_service.list_documents(session)


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> None:
    """Delete a document and its chunks (FR-11)."""
    await document_service.delete_document(session, settings, document_id)
