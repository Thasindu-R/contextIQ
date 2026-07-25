"""Shared retrieval result type.

Single responsibility (NFR-5): the one chunk-result shape produced by
semantic search, keyword search, and RRF fusion alike, so retriever.py
and services.qa_service can consume any of them interchangeably.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

RetrievalSource = Literal["semantic", "keyword", "both"]


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    """One retrieved chunk plus enough metadata to cite and rank it."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    page_number: int | None
    text: str
    score: float


@dataclass(frozen=True, slots=True)
class RankedChunk:
    """A retrieved chunk plus the provenance explaining *why* it ranked
    where it did — what retriever.retrieve returns for every mode.

    This is deliberately a wrapper rather than extra fields on
    RetrievedChunk: semantic.search and keyword.search each produce
    plain RetrievedChunks and know nothing about the other leg, so
    provenance only becomes knowable one level up, in retriever.
    Keeping it separate also keeps generation/ on the narrower
    RetrievedChunk (see prompt_builder) — a prompt has no business
    seeing ranks.

    Unlike fusion.FusedChunk, which only ever describes a *fused*
    result, this covers all three modes (FR-15): semantic-only and
    keyword-only fill in the one rank that applies and leave the other
    None, so at least one rank is always set.

    `score` is whatever the originating mode ranks by, and is
    comparable only within that mode: cosine distance for SEMANTIC
    (lower is better), ts_rank_cd for KEYWORD (higher is better), and
    the RRF fused score for HYBRID (higher is better).
    """

    chunk: RetrievedChunk
    score: float
    semantic_rank: int | None
    keyword_rank: int | None

    @property
    def source(self) -> RetrievalSource:
        """Which search leg(s) produced this chunk (FR-15 debug view)."""
        if self.semantic_rank is not None and self.keyword_rank is not None:
            return "both"
        if self.semantic_rank is not None:
            return "semantic"
        return "keyword"
