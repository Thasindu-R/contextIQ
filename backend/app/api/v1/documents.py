"""Documents API routes.

Single responsibility (NFR-5): HTTP routing/validation only for
document upload (FR-1) and list/delete (FR-11). Delegates all logic
to services.document_service — no SQL or file parsing here.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, UploadFile

from app.schemas.document import DocumentOut

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentOut)
async def upload_document(file: UploadFile) -> DocumentOut:
    """Upload a document for ingestion (FR-1).

    TODO: delegate to services.document_service.upload_document.
    """
    raise NotImplementedError


@router.get("", response_model=list[DocumentOut])
async def list_documents() -> list[DocumentOut]:
    """List all uploaded documents (FR-11).

    TODO: delegate to services.document_service.list_documents.
    """
    raise NotImplementedError


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: uuid.UUID) -> None:
    """Delete a document and its chunks (FR-11).

    TODO: delegate to services.document_service.delete_document.
    """
    raise NotImplementedError
