"""Chunk ORM model.

Single responsibility (NFR-5): define the `chunks` table mapping,
including the pgvector embedding column. No query logic lives here
(see repositories/chunk_repo.py).
"""
from __future__ import annotations

import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.document import Document

EMBEDDING_DIM = 384  # matches all-MiniLM-L6-v2


class Chunk(Base):
    """Represents a chunk of a document, dual-indexed for hybrid search.

    Column set matches the ingestion schema migration
    (alembic/versions/9c080291f1a0_ingestion_schema.py): id,
    document_id, chunk_index, content, page_number, embedding.
    content_tsv is deliberately not mapped here — it's a DB-generated
    STORED column (GENERATED ALWAYS AS to_tsvector(...)) that the
    application never writes or reads directly.
    """

    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int]
    content: Mapped[str]
    page_number: Mapped[int | None]
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))

    # lazy="raise" rather than the default lazy-select: an implicit lazy
    # load would try to run a blocking query outside any greenlet context
    # the async session provides, raising MissingGreenlet. Callers that
    # need the filename (e.g. retrieval) must opt in with
    # `.options(joinedload(Chunk.document))` on their own select.
    document: Mapped[Document] = relationship(lazy="raise")
