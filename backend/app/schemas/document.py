"""Document Pydantic schemas.

Single responsibility (NFR-5): request/response DTOs for the
documents API (FR-1 upload, FR-11 list/delete). No ORM or DB code.
"""
from __future__ import annotations

import datetime
import uuid
from enum import Enum

from pydantic import BaseModel


class DocumentStatus(str, Enum):
    """Lifecycle states for an uploaded document."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DocumentCreate(BaseModel):
    """Payload describing an incoming upload.

    TODO: filename: str, mime_type: str
    """


class DocumentOut(BaseModel):
    """Document representation returned to clients.

    TODO: id: uuid.UUID, filename: str, mime_type: str,
    upload_date: datetime.datetime, status: DocumentStatus,
    page_count: int | None
    """
