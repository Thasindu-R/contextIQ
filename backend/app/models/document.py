"""Document ORM model.

Single responsibility (NFR-5): define the `documents` table mapping
only. No query logic lives here (see repositories/document_repo.py).
"""
from __future__ import annotations

import datetime
import uuid

from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base  # TODO: define declarative Base in database.py


class Document(Base):
    """Represents an uploaded source document.

    Columns (per spec):
      - id: UUID primary key
      - filename: str
      - mime_type: str
      - upload_date: datetime
      - status: str (e.g. pending/processing/ready/failed)
      - page_count: int | None

    TODO: declare __tablename__ = "documents" and Mapped[...] columns.
    """

    __tablename__ = "documents"

    id: Mapped[uuid.UUID]
    filename: Mapped[str]
    mime_type: Mapped[str]
    upload_date: Mapped[datetime.datetime]
    status: Mapped[str]
    page_count: Mapped[int | None]
