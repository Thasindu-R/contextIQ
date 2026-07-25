"""Query/answer Pydantic schemas.

Single responsibility (NFR-5): request/response DTOs for the query API
(FR-6 query submission, FR-9 citations, FR-15 retrieval mode
selection). No retrieval or generation logic.
"""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel

from app.retrieval.modes import RetrievalMode


class QueryRequest(BaseModel):
    """Incoming question from the client."""

    question: str
    document_ids: list[uuid.UUID] | None = None
    top_k: int = 5
    mode: Literal["semantic", "keyword", "hybrid"] = "hybrid"


class RetrievedChunkOut(BaseModel):
    """A single retrieved chunk surfaced for debugging/citations."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    text: str
    page: int | None
    score: float


class CitationOut(BaseModel):
    """A source citation attached to a generated answer (FR-9)."""

    document: str
    page: int | None
    chunk_id: uuid.UUID
    snippet: str


class AnswerResponse(BaseModel):
    """Final response returned for a query (FR-6/FR-9)."""

    answer: str
    citations: list[CitationOut]
    retrieved_chunks: list[RetrievedChunkOut]
    retrieval_mode: RetrievalMode
