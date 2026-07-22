"""Document data-access layer.

Single responsibility (NFR-5): all SQL/ORM access for the `documents`
table lives here, keeping the API and service layers free of SQL.
Handles FR-11 view/delete, including cascading chunk deletion.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.schemas.document import DocumentCreate


async def create(session: AsyncSession, payload: DocumentCreate) -> Document:
    """Insert a new document row.

    TODO: build Document from payload, add/flush/refresh, return it.
    """
    raise NotImplementedError


async def get_by_id(session: AsyncSession, document_id: uuid.UUID) -> Document | None:
    """Fetch a single document by id.

    TODO: SELECT ... WHERE id = document_id
    """
    raise NotImplementedError


async def list_all(session: AsyncSession) -> list[Document]:
    """List all documents (FR-11).

    TODO: SELECT * FROM documents ORDER BY upload_date DESC
    """
    raise NotImplementedError


async def delete(session: AsyncSession, document_id: uuid.UUID) -> None:
    """Delete a document and cascade-delete its chunks (FR-11).

    TODO: DELETE FROM documents WHERE id = document_id
    (cascade relies on FK ON DELETE CASCADE, see db/init.sql)
    """
    raise NotImplementedError


async def update_status(session: AsyncSession, document_id: uuid.UUID, status: str) -> None:
    """Update a document's ingestion status.

    TODO: UPDATE documents SET status = status WHERE id = document_id
    """
    raise NotImplementedError
