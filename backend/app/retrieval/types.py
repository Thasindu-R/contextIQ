"""Shared retrieval result type.

Single responsibility (NFR-5): the one chunk-result shape produced by
semantic search, keyword search, and RRF fusion alike, so retriever.py
and services.qa_service can consume any of them interchangeably.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    """One retrieved chunk plus enough metadata to cite and rank it."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    page_number: int | None
    text: str
    score: float
