"""Question-answering orchestration service.

Single responsibility (NFR-5): end-to-end orchestration for a query —
retrieve chunks (via retrieval.retriever), build a prompt (via
generation.prompt_builder), call Claude (via generation.claude_client),
and assemble the final answer with citations (FR-6, FR-9, FR-10).
No SQL, retrieval, or prompt-formatting logic lives directly here.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.query import AnswerResponse, QueryRequest


async def answer_query(session: AsyncSession, request: QueryRequest) -> AnswerResponse:
    """Produce a grounded answer with citations for the given query.

    TODO:
      1. call retrieval.retriever.retrieve(session, request.question,
         request.retrieval_mode, ...)
      2. if no chunks: raise NoContextFound (FR-10 -> "cannot answer")
      3. build prompt via generation.prompt_builder.build_prompt
      4. call generation.claude_client.generate
      5. assemble AnswerResponse with citations from retrieved chunks
    """
    raise NotImplementedError
