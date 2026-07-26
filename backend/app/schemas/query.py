"""Query/answer Pydantic schemas.

Single responsibility (NFR-5): request/response DTOs for the query API
(FR-6 query submission, FR-9 citations, FR-15 retrieval mode
selection), including the frames of the SSE answer stream. No
retrieval or generation logic, and no SSE framing -- turning these
models into `data: {...}` lines is the route's job.
"""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel

from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RetrievalSource


class QueryRequest(BaseModel):
    """Incoming question from the client."""

    question: str
    document_ids: list[uuid.UUID] | None = None
    top_k: int = 5
    mode: Literal["semantic", "keyword", "hybrid"] = "hybrid"


class RetrievedChunkOut(BaseModel):
    """A single retrieved chunk surfaced for debugging/citations.

    source/semantic_rank/keyword_rank are the provenance the retrieval
    debug view renders (FR-15): which search leg found this chunk and
    at what position in each. For single-leg modes exactly one rank is
    set; for hybrid, a chunk with both set is one that placed in both
    legs, which is precisely what RRF rewards.
    """

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    text: str
    page: int | None
    score: float
    source: RetrievalSource
    semantic_rank: int | None
    keyword_rank: int | None


class CitationOut(BaseModel):
    """A source citation attached to a generated answer (FR-9)."""

    document: str
    page: int | None
    chunk_id: uuid.UUID
    snippet: str


class SourceOut(BaseModel):
    """One retrieved chunk joined with its citation, as sent in the
    `done` frame (FR-9/FR-15).

    The pre-streaming API returned `citations` and `retrieved_chunks` as
    two parallel arrays the client had to zip itself. Streaming sends
    the join already done -- filename and page from the citation, score
    and provenance from the chunk, matched on chunk_id -- because there
    is no longer a single JSON body in which "same index" is a
    guarantee the client can lean on.

    Vocabulary stays the backend's: `source` is semantic/keyword/both
    and the ranks keep their leg names. Translating to the UI's
    vector/fused wording is the frontend client's job (see the frontend
    conventions in CLAUDE.md), so this schema keeps mirroring the
    retrieval layer exactly.
    """

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document: str
    page: int | None
    snippet: str
    text: str
    score: float
    source: RetrievalSource
    semantic_rank: int | None
    keyword_rank: int | None


class TokenFrame(BaseModel):
    """One text delta from the model, in generation order."""

    type: Literal["token"] = "token"
    text: str


class DoneFrame(BaseModel):
    """Terminal frame on a successful stream -- exactly one, last.

    Carries `retrieval_mode` alongside `sources` because the retrieval
    debug view labels each score by the mode that produced it, and
    score is meaningless without it (cosine distance vs ts_rank_cd vs
    RRF). It is null on the FR-10 refusal, matching the pre-streaming
    contract.
    """

    type: Literal["done"] = "done"
    sources: list[SourceOut]
    retrieval_mode: RetrievalMode | None


class ErrorFrame(BaseModel):
    """Terminal frame when generation fails -- sent *instead of* `done`.

    Once the response body has started, the status code is already
    committed to 200, so an upstream failure can only be reported
    in-band. `message` carries the same text the pre-streaming path put
    in a 502's `detail`.
    """

    type: Literal["error"] = "error"
    message: str


QueryStreamFrame = TokenFrame | DoneFrame | ErrorFrame
