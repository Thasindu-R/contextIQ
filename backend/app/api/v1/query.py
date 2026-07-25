"""Query API routes.

Single responsibility (NFR-5): HTTP routing/validation only for
question submission (FR-6) returning grounded answers with citations
(FR-9). Delegates all logic to services.qa_service.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_embedding_service
from app.ingestion.embedding import EmbeddingService
from app.schemas.query import AnswerResponse, QueryRequest
from app.services import qa_service

router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=AnswerResponse)
async def submit_query(
    request: QueryRequest,
    session: AsyncSession = Depends(get_db),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
) -> AnswerResponse:
    """Submit a question and receive a grounded answer (FR-6)."""
    return await qa_service.answer_query(session, embedding_service, request)
