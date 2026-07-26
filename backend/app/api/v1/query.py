"""Query API routes.

Single responsibility (NFR-5): HTTP routing/validation only for
question submission (FR-6), streaming grounded answers with citations
(FR-9) over Server-Sent Events. Owns the SSE wire format -- turning
service frames into `data: {...}` lines and setting the stream
headers -- and delegates all retrieval/generation logic to
services.qa_service.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_embedding_service
from app.ingestion.embedding import EmbeddingService
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk
from app.schemas.query import QueryRequest
from app.services import qa_service

router = APIRouter(prefix="/query", tags=["query"])

# Cache-Control and Connection are the conventional SSE pair.
# X-Accel-Buffering is the one that actually matters in deployment:
# nginx (and the buffering proxies in front of Railway/Render/Fly) will
# happily accumulate a whole response before forwarding it, which turns
# a token-by-token stream back into one delayed blob -- working locally
# and looking broken in production.
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


async def _sse_frames(
    question: str,
    mode: RetrievalMode,
    ranked: list[RankedChunk],
    http_request: Request,
) -> AsyncIterator[str]:
    """Serialize service frames as SSE `data:` events.

    The blank line terminating each event is required by the SSE spec,
    not decoration -- without it a client's parser never dispatches the
    event and the stream appears to hang.
    """
    async for frame in qa_service.stream_answer(
        question,
        mode,
        ranked,
        is_disconnected=http_request.is_disconnected,
    ):
        yield f"data: {frame.model_dump_json()}\n\n"


@router.post("")
async def submit_query(
    request: QueryRequest,
    http_request: Request,
    session: AsyncSession = Depends(get_db),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
) -> StreamingResponse:
    """Submit a question and stream back a grounded answer (FR-6).

    Retrieval runs here, before the response starts, so its failures
    still map to real status codes (see qa_service.retrieve_context).
    Everything after the first byte is committed to a 200, which is why
    a generation failure arrives as an `error` frame rather than a 502.
    """
    ranked = await qa_service.retrieve_context(session, embedding_service, request)

    return StreamingResponse(
        _sse_frames(request.question, RetrievalMode(request.mode), ranked, http_request),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
