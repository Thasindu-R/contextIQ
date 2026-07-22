"""Document ORM model.

Single responsibility (NFR-5): define the `documents` table mapping
only. No query logic lives here (see repositories/document_repo.py).
"""
from __future__ import annotations

import datetime
import uuid

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Document(Base):
    """Represents an uploaded source document.

    Column set matches the ingestion schema migration
    (alembic/versions/9c080291f1a0_ingestion_schema.py) exactly: id,
    filename, upload_time, status, page_count. mime_type is not
    persisted — it's only used transiently to route extraction.
    """

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename: Mapped[str]
    upload_time: Mapped[datetime.datetime] = mapped_column(server_default=func.now())
    status: Mapped[str] = mapped_column(server_default="pending")
    page_count: Mapped[int | None]
