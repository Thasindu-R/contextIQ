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

# websearch_to_tsquery treats adjacent words as AND, which is right for a
# search box and wrong for this leg: a whole question ANDs every content
# word ('much' & 'notic' & 'requir' & 'cancel' & 'automat' & 'renew') and
# no single chunk holds all of them, so keyword search returned nothing
# for anything phrased as a sentence -- and hybrid silently collapsed to
# semantic-only. These are the websearch operators we strip before
# OR-joining, so a stray one can't flip the meaning of the query.
_WEBSEARCH_OPERATORS = frozenset({"or", "and"})


def _to_or_query_text(query_text: str) -> str:
    """Rewrite a query so its terms are OR-ed rather than AND-ed.

    Recall is this leg's job: surface every chunk containing *any*
    salient term and let ts_rank_cd's proximity/density ranking and
    top_k decide what survives, with RRF fusing it against the semantic
    leg afterwards. Precision comes from ranking, not from demanding
    that one chunk contain the entire question.

    The result is still handed to websearch_to_tsquery as a bound
    parameter, so stemming and stopword removal stay identical to the
    stored column's, and no user input reaches SQL unparameterised.

    A leading "-" is stripped rather than honoured: websearch reads it
    as NOT, and a negation OR-ed into the rest ('a' | !'b') matches
    almost every chunk in the corpus. Ignoring it widens recall
    slightly, which fusion tolerates; honouring it here would not.
    Quoted phrases lose their adjacency for the same reason -- both are
    search-box syntax that nothing in the UI offers, and neither is
    worth a query that silently means the opposite of what it says.
    """
    terms = [term.lstrip("-") for term in query_text.split()]
    return " or ".join(term for term in terms if term and term.lower() not in _WEBSEARCH_OPERATORS)


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

    websearch_to_tsquery (not plainto_tsquery/to_tsquery) so the caller
    never hand-constructs tsquery syntax and stemming/stopword handling
    matches the stored column; query_text is bound as a normal
    parameter, never interpolated into SQL. Its terms are OR-ed first --
    see _to_or_query_text for why AND made this leg useless for
    question-shaped queries. ts_rank_cd (not plain ts_rank) additionally
    rewards term proximity/density within a chunk, which matters more
    here than ts_rank's pure frequency-weighted score given chunks are
    short, and matters *more* under OR: it is what keeps a chunk
    matching one incidental term below one matching several.
    """
    content_tsv = column("content_tsv")
    tsquery = func.websearch_to_tsquery(TEXT_SEARCH_CONFIG, _to_or_query_text(query_text))
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
    That still holds once terms are OR-ed: OR-ing nothing is nothing.
    """
    stmt = build_keyword_search_stmt(query_text, top_k, document_ids)
    result = await session.execute(stmt)
    return [(row.Chunk, row.rank) for row in result]
