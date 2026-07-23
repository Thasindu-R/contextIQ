"""Chunk data-access layer.

Single responsibility (NFR-5): all SQL/ORM access for the `chunks`
table lives here — bulk inserts from ingestion, and the low-level
semantic/keyword query primitives used by the retrieval layer
(FR-7 semantic, FR-13 keyword). No fusion or ranking logic here.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Select, column, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.chunk import Chunk

# Must match the config baked into the generated column:
# content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content))
# STORED (see alembic/versions/9c080291f1a0_ingestion_schema.py). A mismatch
# here would silently return zero rows, since tsquery lexemes are stemmed
# per-config -- an 'english'-stemmed query against a differently-stemmed
# column (or vice versa) just never matches.
TEXT_SEARCH_CONFIG = "english"


async def bulk_insert(session: AsyncSession, chunks: list[Chunk]) -> None:
    """Persist a batch of chunks (with embeddings) for a document.

    Meant to compose inside a caller-managed `async with
    session.begin()` block alongside document_repo.create, so the
    document row and all its chunks land in one transaction.
    """
    session.add_all(chunks)
    await session.flush()


def build_semantic_search_stmt(
    query_embedding: list[float],
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> Select:
    """Build (but don't execute) the semantic-search SELECT.

    Split out from semantic_search() so tests can wrap this exact
    statement with `.prefix_with("EXPLAIN")` to confirm the HNSW index
    (ix_chunks_embedding_hnsw, see the ingestion-schema migration) is
    actually used, rather than testing a hand-copied approximation of
    the query.

    Chunk.embedding.cosine_distance(...) emits the pgvector `<=>`
    operator (see pgvector.sqlalchemy.Vector.Comparator); the query
    vector is bound as a normal parameter — its bind_processor
    serializes the Python list to pgvector's text format — never
    string-interpolated into the SQL itself.
    """
    distance = Chunk.embedding.cosine_distance(query_embedding)
    stmt = (
        select(Chunk, distance.label("distance"))
        .options(joinedload(Chunk.document))
        .order_by(distance)
        .limit(top_k)
    )
    if document_ids:
        stmt = stmt.where(Chunk.document_id.in_(document_ids))
    return stmt


async def semantic_search(
    session: AsyncSession,
    query_embedding: list[float],
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Cosine-similarity nearest-neighbor search over `embedding` (FR-7).

    Ascending cosine distance (0 = identical), so ORDER BY it directly
    yields nearest-first. Returns (chunk, distance) pairs — lower is
    more similar.
    """
    stmt = build_semantic_search_stmt(query_embedding, top_k, document_ids)
    result = await session.execute(stmt)
    return [(row.Chunk, row.distance) for row in result]


def build_keyword_search_stmt(
    query_text: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> Select:
    """Build (but don't execute) the keyword-search SELECT.

    content_tsv is a DB-generated STORED column (see models/chunk.py's
    docstring for why it isn't ORM-mapped), so it's referenced here via
    a bare `column("content_tsv")` construct rather than an attribute
    on Chunk -- this still renders as a normal, indexed column
    reference (ix_chunks_content_tsv is a GIN index over it) since the
    FROM clause already includes `chunks`.

    websearch_to_tsquery (not plainto_tsquery/to_tsquery) so natural
    phrasing and "quoted exact phrases" both work without the caller
    needing to hand-construct tsquery syntax; query_text is bound as a
    normal parameter, never interpolated into SQL. ts_rank_cd (not
    plain ts_rank) additionally rewards term proximity/density within
    a chunk, which matters more here than ts_rank's pure
    frequency-weighted score given chunks are short.
    """
    content_tsv = column("content_tsv")
    tsquery = func.websearch_to_tsquery(TEXT_SEARCH_CONFIG, query_text)
    rank = func.ts_rank_cd(content_tsv, tsquery).label("rank")
    stmt = (
        select(Chunk, rank)
        .options(joinedload(Chunk.document))
        .where(content_tsv.op("@@")(tsquery))
        .order_by(rank.desc())
        .limit(top_k)
    )
    if document_ids:
        stmt = stmt.where(Chunk.document_id.in_(document_ids))
    return stmt


async def keyword_search(
    session: AsyncSession,
    query_text: str,
    top_k: int,
    document_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Chunk, float]]:
    """Full-text search over `content_tsv` using websearch_to_tsquery /
    ts_rank_cd (FR-13).

    Descending rank (higher = more relevant), so ORDER BY rank DESC
    gives best-match-first. Returns (chunk, rank) pairs. An
    empty/whitespace-only or stopword-only query_text yields a tsquery
    with zero lexemes, which `@@` never matches -- this returns an
    empty list rather than raising, with no special-casing needed here.
    """
    stmt = build_keyword_search_stmt(query_text, top_k, document_ids)
    result = await session.execute(stmt)
    return [(row.Chunk, row.rank) for row in result]
