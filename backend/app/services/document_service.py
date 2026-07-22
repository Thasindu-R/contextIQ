"""Document orchestration service.

Single responsibility (NFR-5): sits between the documents API and the
document repository / ingestion pipeline. Handles upload persistence,
triggering background ingestion (NFR-1), and list/delete orchestration
(FR-1, FR-11). No SQL or file-parsing logic here.
"""
from __future__ import annotations

import uuid
from typing import BinaryIO

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.document import DocumentOut


async def upload_document(
    session: AsyncSession, file: BinaryIO, filename: str, mime_type: str
) -> DocumentOut:
    """Persist the uploaded file to storage, create a Document row,
    and schedule ingestion.pipeline.run as a background task (FR-1, NFR-1).

    TODO: validate mime_type (raise UnsupportedFileType if unsupported),
    save to backend/storage, insert via document_repo, enqueue ingestion.
    """
    raise NotImplementedError


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
