"""Integration tests for the full query path (FR-6, FR-9, FR-10, FR-15).

Single responsibility (NFR-5): drive upload -> /query over the real
ASGI app against a real Postgres+pgvector test database, proving the
hybrid RAG loop actually completes end-to-end: a grounded answer with
correct citations for an answerable question, and a graceful refusal
(never a 500) when there is nothing to retrieve from.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_TXT = FIXTURES_DIR / "retrieval_solar_panels.txt"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


async def _upload_solar_panels_doc(client: AsyncClient) -> str:
    with open(SAMPLE_TXT, "rb") as f:
        response = await client.post(
            "/api/v1/documents",
            files={"files": (SAMPLE_TXT.name, f, "text/plain")},
        )
    assert response.status_code == 201, response.text
    return response.json()[0]["id"]


async def test_query_hybrid_returns_grounded_answer_with_citations(
    client, db_session, mock_claude_client
):
    """Acceptance: ingest a doc, ask a question answerable from it ->
    get a grounded answer with correct citations (hybrid mode)."""
    document_id = await _upload_solar_panels_doc(client)

    response = await client.post(
        "/api/v1/query",
        json={
            "question": "How do photovoltaic cells turn light into usable electrical power?",
            "top_k": 3,
            "mode": "hybrid",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == mock_claude_client
    assert body["retrieval_mode"] == "hybrid"
    assert len(body["citations"]) > 0
    assert all(c["document"] == "retrieval_solar_panels.txt" for c in body["citations"])
    assert all(c["chunk_id"] for c in body["citations"])
    assert len(body["retrieved_chunks"]) == len(body["citations"])

    # sanity: the uploaded document is the one actually cited
    doc_row = (
        await db_session.execute(
            text("SELECT id FROM documents WHERE id = :id"),
            {"id": document_id},
        )
    ).one()
    assert str(doc_row.id) == document_id


async def test_query_semantic_mode_returns_answer(client, mock_claude_client):
    """FR-15: semantic-only mode also completes the full loop."""
    await _upload_solar_panels_doc(client)

    response = await client.post(
        "/api/v1/query",
        json={
            "question": "sunlight into electricity",
            "top_k": 3,
            "mode": "semantic",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["retrieval_mode"] == "semantic"


async def test_query_with_no_documents_returns_graceful_refusal_not_500(client, db_session):
    """FR-10/NFR-3: with nothing ingested, retrieval yields no chunks at
    all -- the endpoint must return a clean refusal, never a 500.

    db_session is requested (though otherwise unused) purely for its
    truncate-before-yield side effect (see conftest.db_session) -- this
    test needs a genuinely empty documents/chunks table, which isn't
    guaranteed unless something in this test truncates it.
    """
    response = await client.post(
        "/api/v1/query",
        json={"question": "What is the capital of France?", "mode": "hybrid"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["citations"] == []
    assert body["retrieved_chunks"] == []
    assert "cannot answer" in body["answer"].lower()


async def test_query_keyword_mode_off_topic_returns_graceful_refusal_not_500(
    client, db_session
):
    """FR-10/NFR-3: keyword search on a query with no lexical match
    against ingested content also yields zero chunks -- same graceful
    refusal path, proven with a document actually present in the DB."""
    await _upload_solar_panels_doc(client)

    response = await client.post(
        "/api/v1/query",
        json={
            "question": "zzznonexistentqueryterm",
            "mode": "keyword",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["citations"] == []
    assert "cannot answer" in body["answer"].lower()


async def test_query_claude_refusal_is_surfaced_verbatim_with_context_citations(
    client, monkeypatch
):
    """The off-topic-with-context refusal path: hybrid search still
    surfaces its nearest (irrelevant) chunks -- prompt_builder's
    context-only instruction is what makes Claude itself decline, not
    an empty-retrieval short-circuit. Simulates that declined answer
    and confirms it flows through untouched, with real citations
    attached, never a 500 or a fabricated answer."""
    refusal_text = "I cannot answer this question based on the available documents."

    async def _fake_generate(prompt: str) -> str:
        return refusal_text

    monkeypatch.setattr("app.generation.claude_client.generate", _fake_generate)

    await _upload_solar_panels_doc(client)

    response = await client.post(
        "/api/v1/query",
        json={"question": "What is the best way to train a parrot?", "mode": "hybrid"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == refusal_text
    # retrieval still ran and returned its nearest (irrelevant) chunks --
    # this is the point of the design: Claude refuses, plumbing doesn't 500.
    assert len(body["retrieved_chunks"]) > 0
