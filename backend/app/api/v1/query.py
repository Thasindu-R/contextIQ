"""Query API routes.

Single responsibility (NFR-5): HTTP routing/validation only for
question submission (FR-6) returning grounded answers with citations
(FR-9). Delegates all logic to services.qa_service.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.query import AnswerResponse, QueryRequest

router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=AnswerResponse)
async def submit_query(request: QueryRequest) -> AnswerResponse:
    """Submit a question and receive a grounded answer (FR-6).

    TODO: delegate to services.qa_service.answer_query.
    """
    raise NotImplementedError
