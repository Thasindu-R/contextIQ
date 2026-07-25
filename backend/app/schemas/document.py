"""Document Pydantic schemas.

Single responsibility (NFR-5): request/response DTOs for the
documents API (FR-1 upload, FR-11 list/delete). No ORM or DB code.
"""
from __future__ import annotations

import datetime
import uuid
from enum import StrEnum

from pydantic import BaseModel


class DocumentStatus(StrEnum):
    """Lifecycle states for an uploaded document."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DocumentCreate(BaseModel):
    """Payload describing an incoming upload."""

    filename: str
    mime_type: str


class DocumentOut(BaseModel):
    """Document representation returned to clients.

    Mirrors the persisted `documents` row exactly (see the ingestion
    schema migration) — mime_type is not a column and isn't included.
    """

    id: uuid.UUID
    filename: str
    upload_time: datetime.datetime
    status: DocumentStatus
    page_count: int | None
