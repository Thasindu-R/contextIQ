"""Document data-access layer.

Single responsibility (NFR-5): all SQL/ORM access for the `documents`
table lives here, keeping the API and service layers free of SQL.
Handles FR-11 view/delete, including cascading chunk deletion.
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete as sa_delete
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document


async def create(session: AsyncSession, document: Document) -> Document:
    """Add a fully-built Document row and flush it.

    Takes the ORM object directly (not a DocumentCreate payload) —
    the caller (services.document_service) already knows the id,
    filename, status, and page_count by the time it's ready to
    persist, and this is meant to compose inside a caller-managed
    `async with session.begin()` block, not commit on its own.
    """
    session.add(document)
    await session.flush()
    return document


async def get_by_id(session: AsyncSession, document_id: uuid.UUID) -> Document | None:
    """Fetch a single document by id."""
    stmt = select(Document).where(Document.id == document_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def list_all(session: AsyncSession) -> list[Document]:
    """List all documents (FR-11), newest first."""
    stmt = select(Document).order_by(Document.upload_time.desc())
    return list((await session.execute(stmt)).scalars().all())


async def delete(session: AsyncSession, document_id: uuid.UUID) -> None:
    """Delete a document and cascade-delete its chunks (FR-11).

    Cascade relies on the chunks.document_id FK's ON DELETE CASCADE
    (see the ingestion-schema migration) -- deleting only the
    documents row is enough.
    """
    stmt = sa_delete(Document).where(Document.id == document_id)
    await session.execute(stmt)


async def update_status(session: AsyncSession, document_id: uuid.UUID, status: str) -> None:
    """Update a document's ingestion status."""
    stmt = update(Document).where(Document.id == document_id).values(status=status)
    await session.execute(stmt)
