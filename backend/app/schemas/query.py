"""Query/answer Pydantic schemas.

Single responsibility (NFR-5): request/response DTOs for the query API
(FR-6 query submission, FR-9 citations, FR-15 retrieval mode
selection). No retrieval or generation logic.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.retrieval.modes import RetrievalMode


class QueryRequest(BaseModel):
    """Incoming question from the client.

    TODO: question: str, document_ids: list[uuid.UUID] | None,
    retrieval_mode: RetrievalMode = RetrievalMode.HYBRID
    """


class RetrievedChunkOut(BaseModel):
    """A single retrieved chunk surfaced for debugging/citations.

    TODO: chunk_id: uuid.UUID, document_id: uuid.UUID, text: str,
    page: int | None, score: float, source: str  # "semantic" | "keyword" | "fused"
    """


class CitationOut(BaseModel):
    """A source citation attached to a generated answer (FR-9).

    TODO: document_id: uuid.UUID, filename: str, page: int | None,
    chunk_id: uuid.UUID
    """


class AnswerResponse(BaseModel):
    """Final response returned for a query (FR-6/FR-9).

    TODO: answer: str, citations: list[CitationOut],
    retrieved_chunks: list[RetrievedChunkOut], retrieval_mode: RetrievalMode
    """
