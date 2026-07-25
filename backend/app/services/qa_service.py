"""Question-answering orchestration service.

Single responsibility (NFR-5): end-to-end orchestration for a query —
retrieve chunks (via retrieval.retriever), build a prompt (via
generation.prompt_builder), call Claude (via generation.claude_client),
and assemble the final answer with citations (FR-6, FR-9, FR-10).
No SQL, retrieval, or prompt-formatting logic lives directly here.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NoContextFound
from app.generation import claude_client, prompt_builder
from app.ingestion.embedding import EmbeddingService
from app.retrieval import retriever
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RankedChunk, RetrievedChunk
from app.schemas.query import AnswerResponse, CitationOut, QueryRequest, RetrievedChunkOut

SNIPPET_LENGTH = 300


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


def _to_retrieved_chunk_out(ranked: RankedChunk) -> RetrievedChunkOut:
    """Flatten a RankedChunk into the wire shape.

    The score reported is the RankedChunk's, not the inner chunk's:
    for hybrid those differ, and it's the fused score that explains
    the ordering the client is looking at (see retriever.retrieve).
    """
    return RetrievedChunkOut(
        chunk_id=ranked.chunk.chunk_id,
        document_id=ranked.chunk.document_id,
        text=ranked.chunk.text,
        page=ranked.chunk.page_number,
        score=ranked.score,
        source=ranked.source,
        semantic_rank=ranked.semantic_rank,
        keyword_rank=ranked.keyword_rank,
    )


async def answer_query(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    request: QueryRequest,
) -> AnswerResponse:
    """Produce a grounded answer with citations for the given query (FR-6).

    Raises NoContextFound (FR-10) when retrieval yields nothing at all
    -- e.g. no documents have been ingested yet -- before ever building
    a prompt or calling Claude. An off-topic-but-nonempty retrieval
    (the common case: hybrid search always returns its nearest chunks,
    however irrelevant) is instead handled by prompt_builder's
    context-only instruction, which tells Claude itself to refuse.
    """
    mode = RetrievalMode(request.mode)
    ranked = await retriever.retrieve(
        session,
        embedding_service,
        request.question,
        mode,
        request.top_k,
        request.document_ids,
    )
    if not ranked:
        raise NoContextFound(f"No retrievable context for question: {request.question!r}")

    # generation/ only ever sees the plain chunks -- rank provenance is
    # for the debug view, not for the prompt.
    prompt = prompt_builder.build_prompt(request.question, [rc.chunk for rc in ranked])
    answer = await claude_client.generate(prompt)

    return AnswerResponse(
        answer=answer,
        citations=[_to_citation(rc.chunk) for rc in ranked],
        retrieved_chunks=[_to_retrieved_chunk_out(rc) for rc in ranked],
        retrieval_mode=mode,
    )
