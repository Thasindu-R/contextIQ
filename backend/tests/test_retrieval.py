"""Tests for the retrieval layer.

Single responsibility (NFR-5): verify semantic search, keyword
search, RRF fusion, and the retriever's mode dispatch (FR-7, FR-13,
FR-14, FR-15).
"""
from __future__ import annotations

import time
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.ingestion import pipeline
from app.ingestion.embedding import load_model
from app.ingestion.extraction import TEXT_MIME_TYPE
from app.models.chunk import Chunk
from app.models.document import Document
from app.repositories import chunk_repo, document_repo
from app.retrieval import keyword, retriever, semantic
from app.retrieval.fusion import reciprocal_rank_fusion
from app.retrieval.modes import RetrievalMode
from app.retrieval.types import RetrievedChunk

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def embedding_service():
    """Loads the real all-MiniLM-L6-v2 model once for this test module.

    Reused for both ingestion and query embedding below, mirroring how
    app.main's lifespan shares a single EmbeddingService instance for
    the app's whole lifetime (semantic.search must never construct a
    second model).
    """
    return load_model("all-MiniLM-L6-v2")


async def _ingest_fixture(db_session, embedding_service, filename: str) -> Document:
    """Ingest one fixtures/*.txt file the same way document_service does
    (extract -> chunk -> embed -> persist document + chunks in one
    transaction), without going through the HTTP layer."""
    pages, ingested_chunks = await pipeline.run(
        file_path=str(FIXTURES_DIR / filename),
        mime_type=TEXT_MIME_TYPE,
        embedding_service=embedding_service,
        chunk_size=500,
        chunk_overlap=50,
    )
    document = Document(id=uuid.uuid4(), filename=filename, status="ready", page_count=len(pages))
    chunk_rows = [
        Chunk(
            id=uuid.uuid4(),
            document_id=document.id,
            chunk_index=ingested.chunk.chunk_index,
            content=ingested.chunk.text,
            page_number=ingested.chunk.page,
            embedding=ingested.embedding,
        )
        for ingested in ingested_chunks
    ]
    async with db_session.begin():
        await document_repo.create(db_session, document)
        await chunk_repo.bulk_insert(db_session, chunk_rows)
    return document


async def _ingest_three_topic_fixtures(db_session, embedding_service) -> dict[str, Document]:
    documents = {}
    for filename in ("retrieval_wombats.txt", "retrieval_solar_panels.txt", "retrieval_keyboards.txt"):
        documents[filename] = await _ingest_fixture(db_session, embedding_service, filename)
    return documents


async def test_semantic_search_ranks_paraphrase_match_first(db_session, embedding_service):
    """FR-7: a paraphrased query about one document's topic should
    surface that document's chunk at rank 0, ahead of two unrelated
    documents also present in the table."""
    documents = await _ingest_three_topic_fixtures(db_session, embedding_service)
    solar_doc = documents["retrieval_solar_panels.txt"]

    results = await semantic.search(
        db_session,
        embedding_service,
        query="How do photovoltaic cells turn light into usable electrical power?",
        top_k=3,
    )

    assert len(results) == 3
    top = results[0]
    assert top.document_id == solar_doc.id
    assert top.filename == "retrieval_solar_panels.txt"
    assert "photovoltaic" in top.text
    # cosine distance: ascending / nearest-first, and the true match
    # should be a clear margin closer than the next-best result.
    assert results[0].score < results[1].score


async def test_semantic_search_filters_by_document_ids(db_session, embedding_service):
    """document_ids should restrict the search to only those documents,
    even when a better global match exists outside the filter set."""
    documents = await _ingest_three_topic_fixtures(db_session, embedding_service)
    wombat_doc = documents["retrieval_wombats.txt"]

    results = await semantic.search(
        db_session,
        embedding_service,
        query="How do photovoltaic cells turn light into usable electrical power?",
        top_k=3,
        document_ids=[wombat_doc.id],
    )

    assert len(results) == 1
    assert results[0].document_id == wombat_doc.id
    assert results[0].filename == "retrieval_wombats.txt"


async def test_semantic_search_query_plan_uses_hnsw_index(db_session, embedding_service):
    """Confirms ix_chunks_embedding_hnsw (see the ingestion-schema
    migration) is a usable index for this exact query, not just an
    index that happens to exist. SET LOCAL enable_seqscan = off forces
    the planner to prefer an index path when one is applicable — on a
    handful of test rows, cost-based planning would otherwise pick a
    sequential scan regardless of the index, which would make this
    check pass even if the operator class were wrong."""
    await _ingest_fixture(db_session, embedding_service, "retrieval_solar_panels.txt")
    [query_embedding] = embedding_service.embed_texts(["sunlight into electricity"])

    # Literal-bind the compiled statement rather than passing the vector
    # as a driver parameter: EXPLAIN is introspection-only, never part of
    # the real query path, and asyncpg's EXPLAIN support for parameterized
    # statements is unreliable across drivers -- production retrieval
    # (chunk_repo.semantic_search) always binds the embedding as a real
    # parameter, never like this.
    stmt = chunk_repo.build_semantic_search_stmt(query_embedding, top_k=5)
    compiled = stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    explain_stmt = text(f"EXPLAIN {compiled}")

    async with db_session.begin():
        await db_session.execute(text("SET LOCAL enable_seqscan = off"))
        plan_rows = (await db_session.execute(explain_stmt)).all()

    plan = "\n".join(row[0] for row in plan_rows)
    assert "ix_chunks_embedding_hnsw" in plan, plan


IDENTIFIER_QUERY = "TICKET-88214-QX7"


async def _ingest_identifier_scenario_fixtures(db_session, embedding_service) -> dict[str, Document]:
    """5 documents: one contains the exact identifier buried in a long,
    topically generic paragraph; one is topically similar (billing/
    support boilerplate) but never mentions the identifier; three are
    unrelated filler. Chosen and empirically verified (via direct
    sentence-transformers cosine similarity) so that for the bare
    identifier as a query, the *topically similar* distractor actually
    embeds closer to the query than the true match does (0.395 vs.
    0.289 cosine similarity) -- dense embeddings dilute a short rare
    token's signal across a long chunk, which is exactly the failure
    mode hybrid search's keyword leg exists to cover."""
    documents = {}
    for filename in (
        "retrieval_ticket_id.txt",
        "retrieval_support_boilerplate.txt",
        "retrieval_wombats.txt",
        "retrieval_solar_panels.txt",
        "retrieval_keyboards.txt",
    ):
        documents[filename] = await _ingest_fixture(db_session, embedding_service, filename)
    return documents


async def test_keyword_search_ranks_exact_identifier_match_first(db_session, embedding_service):
    """FR-13: an exact-match query for a precise identifier must surface
    the chunk containing it at rank 0, even though (per
    test_keyword_search_beats_semantic_search_on_exact_identifier below)
    a topically-similar chunk without the identifier scores higher on
    dense embedding similarity for this same query."""
    documents = await _ingest_identifier_scenario_fixtures(db_session, embedding_service)
    ticket_doc = documents["retrieval_ticket_id.txt"]

    results = await keyword.search(db_session, query=IDENTIFIER_QUERY, top_k=5)

    assert len(results) == 1, "only the chunk containing the identifier should match at all"
    assert results[0].document_id == ticket_doc.id
    assert results[0].filename == "retrieval_ticket_id.txt"
    assert "TICKET-88214-QX7" in results[0].text


async def test_keyword_search_beats_semantic_search_on_exact_identifier(db_session, embedding_service):
    """The case hybrid search exists to solve: for a bare-identifier
    query, keyword search finds the exact match while semantic search's
    top result is a different, merely topically-similar document."""
    documents = await _ingest_identifier_scenario_fixtures(db_session, embedding_service)
    ticket_doc = documents["retrieval_ticket_id.txt"]

    keyword_results = await keyword.search(db_session, query=IDENTIFIER_QUERY, top_k=5)
    semantic_results = await semantic.search(
        db_session, embedding_service, query=IDENTIFIER_QUERY, top_k=5
    )

    assert keyword_results[0].document_id == ticket_doc.id
    assert semantic_results[0].document_id != ticket_doc.id


async def test_keyword_search_filters_by_document_ids(db_session, embedding_service):
    documents = await _ingest_identifier_scenario_fixtures(db_session, embedding_service)
    support_doc = documents["retrieval_support_boilerplate.txt"]

    results = await keyword.search(
        db_session,
        query=IDENTIFIER_QUERY,
        top_k=5,
        document_ids=[support_doc.id],
    )

    assert results == []


@pytest.mark.parametrize("degenerate_query", ["", "   ", "the a an"])
async def test_keyword_search_degenerate_query_returns_empty_list(
    db_session, embedding_service, degenerate_query
):
    """FR-13: empty, whitespace-only, and stopword-only queries all
    produce a tsquery with zero lexemes -- must return [] rather than
    raising."""
    await _ingest_fixture(db_session, embedding_service, "retrieval_wombats.txt")

    results = await keyword.search(db_session, query=degenerate_query, top_k=5)

    assert results == []


def _dummy_retrieved_chunk(label: str) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        filename=f"{label}.txt",
        page_number=1,
        text=label,
        score=0.0,
    )


def test_reciprocal_rank_fusion_combines_ranked_lists():
    """FR-14: hand-computed RRF scores, k=60.

    semantic = [A(1), B(2), C(3)], keyword = [A(1), B(3), D(2)]:
      score(A) = 1/61 + 1/61          (both lists, rank 1 each)
      score(B) = 1/62 + 1/63          (both lists, ranks 2 and 3)
      score(D) = 1/62                 (keyword only, rank 2)
      score(C) = 1/63                 (semantic only, rank 3)
    Expected order: A > B > D > C -- B (present in both, at ranks 2
    and 3) beats D (present in only one list, but at a better rank of
    2) because it accumulates two reciprocal-rank terms.
    """
    chunk_a, chunk_b, chunk_c, chunk_d = (
        _dummy_retrieved_chunk("a"),
        _dummy_retrieved_chunk("b"),
        _dummy_retrieved_chunk("c"),
        _dummy_retrieved_chunk("d"),
    )
    semantic_results = [chunk_a, chunk_b, chunk_c]
    keyword_results = [chunk_a, chunk_d, chunk_b]  # a=1, d=2, b=3

    fused = reciprocal_rank_fusion([semantic_results, keyword_results], top_k=10, k=60)

    by_id = {fc.chunk.chunk_id: fc for fc in fused}
    assert [fc.chunk.text for fc in fused] == ["a", "b", "d", "c"]

    assert by_id[chunk_a.chunk_id].fused_score == pytest.approx(1 / 61 + 1 / 61)
    assert by_id[chunk_b.chunk_id].fused_score == pytest.approx(1 / 62 + 1 / 63)
    assert by_id[chunk_d.chunk_id].fused_score == pytest.approx(1 / 62)
    assert by_id[chunk_c.chunk_id].fused_score == pytest.approx(1 / 63)

    assert by_id[chunk_a.chunk_id].semantic_rank == 1
    assert by_id[chunk_a.chunk_id].keyword_rank == 1
    assert by_id[chunk_b.chunk_id].semantic_rank == 2
    assert by_id[chunk_b.chunk_id].keyword_rank == 3
    assert by_id[chunk_c.chunk_id].semantic_rank == 3
    assert by_id[chunk_c.chunk_id].keyword_rank is None
    assert by_id[chunk_d.chunk_id].semantic_rank is None
    assert by_id[chunk_d.chunk_id].keyword_rank == 2


def test_reciprocal_rank_fusion_truncates_to_top_k():
    chunk_a, chunk_b, chunk_c, chunk_d = (
        _dummy_retrieved_chunk("a"),
        _dummy_retrieved_chunk("b"),
        _dummy_retrieved_chunk("c"),
        _dummy_retrieved_chunk("d"),
    )
    semantic_results = [chunk_a, chunk_b, chunk_c]
    keyword_results = [chunk_a, chunk_d, chunk_b]

    fused = reciprocal_rank_fusion([semantic_results, keyword_results], top_k=2, k=60)

    assert [fc.chunk.text for fc in fused] == ["a", "b"]


async def test_hybrid_search_returns_fused_results_with_provenance(db_session, embedding_service):
    """Integration: hybrid_search should surface the identifier-bearing
    chunk (via its keyword leg) even though it's not semantic search's
    top pick on its own, and every FusedChunk must carry rank
    provenance from whichever list(s) it came from."""
    documents = await _ingest_identifier_scenario_fixtures(db_session, embedding_service)
    ticket_doc = documents["retrieval_ticket_id.txt"]

    fused = await retriever.hybrid_search(
        db_session, embedding_service, query=IDENTIFIER_QUERY, top_k=5
    )

    assert len(fused) > 0
    ticket_result = next(fc for fc in fused if fc.chunk.document_id == ticket_doc.id)
    assert ticket_result.keyword_rank == 1
    assert ticket_result.fused_score > 0

    for fc in fused:
        assert fc.semantic_rank is not None or fc.keyword_rank is not None
        assert fc.fused_score > 0


async def test_hybrid_search_latency_stays_within_nfr10_budget(db_session, embedding_service):
    """NFR-10: hybrid must not add more than ~1-2s over semantic-only.
    Running semantic + keyword concurrently (asyncio.gather) rather
    than sequentially is what keeps the overhead this small."""
    await _ingest_three_topic_fixtures(db_session, embedding_service)
    query = "How do photovoltaic cells turn light into usable electrical power?"

    start = time.perf_counter()
    await semantic.search(db_session, embedding_service, query, top_k=3)
    semantic_only_elapsed = time.perf_counter() - start

    start = time.perf_counter()
    await retriever.hybrid_search(db_session, embedding_service, query, top_k=3)
    hybrid_elapsed = time.perf_counter() - start

    assert hybrid_elapsed - semantic_only_elapsed < 2.0, (
        f"hybrid added {hybrid_elapsed - semantic_only_elapsed:.3f}s over semantic-only "
        f"(semantic={semantic_only_elapsed:.3f}s, hybrid={hybrid_elapsed:.3f}s)"
    )


async def test_retriever_dispatches_by_mode(monkeypatch):
    """FR-15: retriever.retrieve should call the right backend per mode:
    SEMANTIC -> semantic.search only, KEYWORD -> keyword.search only,
    HYBRID -> retriever.hybrid_search (itself semantic+keyword+RRF)."""
    semantic_chunk = _dummy_retrieved_chunk("semantic-hit")
    keyword_chunk = _dummy_retrieved_chunk("keyword-hit")

    semantic_calls = []
    keyword_calls = []

    async def fake_semantic_search(session, embedding_service, query, top_k, document_ids=None):
        semantic_calls.append(query)
        return [semantic_chunk]

    async def fake_keyword_search(session, query, top_k, document_ids=None):
        keyword_calls.append(query)
        return [keyword_chunk]

    monkeypatch.setattr(semantic, "search", fake_semantic_search)
    monkeypatch.setattr(keyword, "search", fake_keyword_search)

    session = object()
    embedding_service = object()

    semantic_result = await retriever.retrieve(
        session, embedding_service, "q", RetrievalMode.SEMANTIC, top_k=3
    )
    assert semantic_result == [semantic_chunk]
    assert semantic_calls == ["q"] and keyword_calls == []

    keyword_result = await retriever.retrieve(
        session, embedding_service, "q", RetrievalMode.KEYWORD, top_k=3
    )
    assert keyword_result == [keyword_chunk]
    assert keyword_calls == ["q"]

    hybrid_result = await retriever.retrieve(
        session, embedding_service, "q", RetrievalMode.HYBRID, top_k=3
    )
    # hybrid dispatches through hybrid_search -> both backends called again,
    # and the fused result unwraps to plain RetrievedChunk (no FusedChunk).
    assert all(isinstance(chunk, RetrievedChunk) for chunk in hybrid_result)
    assert {chunk.chunk_id for chunk in hybrid_result} == {
        semantic_chunk.chunk_id,
        keyword_chunk.chunk_id,
    }
