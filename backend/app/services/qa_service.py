"""Question-answering orchestration service.

Single responsibility (NFR-5): end-to-end orchestration for a query --
retrieve chunks (via retrieval.retriever), build a prompt (via
generation.prompt_builder), stream Claude's answer (via
generation.claude_client), and assemble the citations (FR-6, FR-9,
FR-10). No SQL, retrieval, or prompt-formatting logic lives directly
here, and no HTTP or SSE framing either -- this yields typed frames and
leaves the wire format to the route.

The split into retrieve_context() then stream_answer() is deliberate,
not incidental. Retrieval isn't streamable (RRF has to see both legs'
complete result sets before it can rank anything), and a response body
cannot carry a status code once it has started. Running retrieval
*before* the route returns its StreamingResponse keeps database and
embedding failures mappable to a real 4xx/5xx; only generation, which
genuinely has to stream, runs inside the response body where the only
way to report a failure is an error frame.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UpstreamAPIError
from app.generation import claude_client, prompt_builder
from app.ingestion.embedding import EmbeddingService
from app.retrieval import retriever
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk, RetrievedChunk
from app.schemas.query import (
    CitationOut,
    DoneFrame,
    ErrorFrame,
    QueryRequest,
    QueryStreamFrame,
    SourceOut,
    TokenFrame,
)

SNIPPET_LENGTH = 300

NO_CONTEXT_ANSWER = "I cannot answer this question based on the available documents."


def _to_citation(chunk: RetrievedChunk) -> CitationOut:
    if len(chunk.text) <= SNIPPET_LENGTH:
        snippet = chunk.text
    else:
        snippet = chunk.text[:SNIPPET_LENGTH] + "..."
    return CitationOut(
        document=chunk.filename,
        page=chunk.page_number,
        chunk_id=chunk.chunk_id,
        snippet=snippet,
    )


def _to_source(ranked: RankedChunk) -> SourceOut:
    """Flatten a RankedChunk and its citation into one wire object --
    the join the client used to do itself against two parallel arrays.

    The score reported is the RankedChunk's, not the inner chunk's: for
    hybrid those differ, and it's the fused score that explains the
    ordering the client is looking at (see retriever.retrieve).
    """
    citation = _to_citation(ranked.chunk)
    return SourceOut(
        chunk_id=ranked.chunk.chunk_id,
        document_id=ranked.chunk.document_id,
        document=citation.document,
        page=citation.page,
        snippet=citation.snippet,
        text=ranked.chunk.text,
        score=ranked.score,
        source=ranked.source,
        semantic_rank=ranked.semantic_rank,
        keyword_rank=ranked.keyword_rank,
    )


async def retrieve_context(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    request: QueryRequest,
) -> list[RankedChunk]:
    """Retrieve the chunks to ground the answer in (FR-6, FR-15).

    Runs to completion before any streaming starts, so a database or
    embedding failure still becomes a proper HTTP error response rather
    than an error frame inside a 200. An empty list is not a failure
    (FR-10) -- it's the no-context refusal, which stream_answer emits.
    """
    return await retriever.retrieve(
        session,
        embedding_service,
        request.question,
        RetrievalMode(request.mode),
        request.top_k,
        request.document_ids,
    )


async def stream_answer(
    question: str,
    mode: RetrievalMode,
    ranked: list[RankedChunk],
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[QueryStreamFrame]:
    """Stream a grounded answer over already-retrieved context (FR-6/FR-9).

    Yields zero or more `token` frames in generation order, then
    exactly one terminal frame: `done` on success, `error` if
    generation failed.

    FR-10, empty retrieval: emits the refusal sentence as a single
    token frame followed by `done` with no sources and a null mode.
    That is a completed answer, not a failure -- an unanswerable
    question is an expected outcome of a Q&A endpoint and must not look
    like an error to the client. The separate case where retrieval
    *does* return chunks but none are relevant is handled by
    prompt_builder's context-only instruction, which makes Claude reply
    with that same sentence; the client treats the string as "no
    answer" either way.

    `is_disconnected` lets the caller supply a liveness check (in
    practice Starlette's Request.is_disconnected). It is polled between
    deltas, and returning True ends the stream immediately without a
    terminal frame -- there is nobody left to send one to. Returning
    early closes the underlying Claude stream on the way out, so
    generation actually stops rather than billing on unread.
    """
    if not ranked:
        yield TokenFrame(text=NO_CONTEXT_ANSWER)
        yield DoneFrame(sources=[], retrieval_mode=None)
        return

    # generation/ only ever sees the plain chunks -- rank provenance is
    # for the debug view, not for the prompt.
    prompt = prompt_builder.build_prompt(question, [rc.chunk for rc in ranked])

    try:
        async for delta in claude_client.stream(prompt):
            if is_disconnected is not None and await is_disconnected():
                return
            yield TokenFrame(text=delta)
    except UpstreamAPIError as exc:
        yield ErrorFrame(message=str(exc))
        return

    yield DoneFrame(sources=[_to_source(rc) for rc in ranked], retrieval_mode=mode)
