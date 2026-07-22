"""Chunk ORM model.

Single responsibility (NFR-5): define the `chunks` table mapping,
including the pgvector embedding column and the tsvector full-text
search column. No query logic lives here (see repositories/chunk_repo.py).
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base  # TODO: define declarative Base in database.py

EMBEDDING_DIM = 384  # matches all-MiniLM-L6-v2


class Chunk(Base):
    """Represents a chunk of a document, dual-indexed for hybrid search.

    Columns (per spec):
      - id: UUID primary key
      - document_id: UUID foreign key -> documents.id
      - text: str
      - page: int | None
      - chunk_index: int
      - embedding: vector(384) (pgvector)
      - text_search: tsvector (generated/maintained via trigger, see db/init.sql)

    TODO: declare __tablename__ = "chunks" and Mapped[...] columns,
    using the pgvector SQLAlchemy type for `embedding` and the
    TSVECTOR type for `text_search`.
    """

    __tablename__ = "chunks"

    id: Mapped[uuid.UUID]
    document_id: Mapped[uuid.UUID]
    text: Mapped[str]
    page: Mapped[int | None]
    chunk_index: Mapped[int]
    # embedding: Mapped[list[float]]  # TODO: pgvector Vector(EMBEDDING_DIM)
    # text_search: Mapped[str]  # TODO: TSVECTOR
