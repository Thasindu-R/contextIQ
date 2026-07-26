"""Prompt construction.

Single responsibility (NFR-5): build a strict context-only prompt
from retrieved chunks (NFR-9), instructing the model to state it
cannot answer when no relevant context is available (FR-10). No
API-calling logic here.

Type contract: this module speaks the detached RetrievedChunk
dataclass (app.retrieval.types), never the Chunk ORM model,
FusedChunk, or RankedChunk. retriever.retrieve returns RankedChunk
(chunk + rank provenance) and qa_service unwraps `.chunk` before
calling in here, so nothing downstream of retrieval needs a live ORM
session -- and a prompt never sees ranks, which are debug-view
concerns with no place in grounding text.
"""
from __future__ import annotations

from app.retrieval.types import RetrievedChunk

NO_CONTEXT_INSTRUCTION = (
    "Answer the question using ONLY the information in the CONTEXT section "
    "below. Do not use any outside knowledge. If the context does not "
    "contain enough information to answer the question, respond exactly "
    "with: \"I cannot answer this question based on the available "
    "documents.\" Do not guess or fabricate an answer."
)


def _format_chunk(index: int, chunk: RetrievedChunk) -> str:
    source = f"{chunk.filename}" + (f", page {chunk.page_number}" if chunk.page_number else "")
    return f"[Source {index}: {source}]\n{chunk.text}"


def build_prompt(question: str, chunks: list[RetrievedChunk]) -> str:
    """Build a context-grounded prompt restricting the model to the
    supplied chunks only (NFR-9).

    NO_CONTEXT_INSTRUCTION is embedded unconditionally, not just when
    `chunks` is empty: retrieval almost always returns *some* nearest
    chunk even for an off-topic question, so the model itself -- not
    an empty-list check -- is what has to recognize "this context
    doesn't actually answer the question" and refuse (FR-10). An
    actually-empty `chunks` list (e.g. no documents ingested yet) is
    guarded against upstream: qa_service.stream_answer emits the
    refusal directly without ever calling this function. This still
    degrades to a plain "no context was retrieved" prompt rather than
    raising, so it stays a pure, independently testable formatting
    function.
    """
    if chunks:
        context = "\n\n".join(_format_chunk(i, chunk) for i, chunk in enumerate(chunks, start=1))
    else:
        context = "(No context was retrieved for this question.)"

    return (
        f"{NO_CONTEXT_INSTRUCTION}\n\n"
        f"CONTEXT:\n{context}\n\n"
        f"QUESTION:\n{question}"
    )
