"""Integration tests for the full query path (FR-6, FR-9, FR-10, FR-15).

Single responsibility (NFR-5): drive upload -> /query over the real
ASGI app against a real Postgres+pgvector test database, proving the
hybrid RAG loop actually completes end-to-end over Server-Sent Events:
an incremental grounded answer with correct citations for an
answerable question, and a graceful refusal (never a 500, never an
error frame) when there is nothing to retrieve from.
"""
from __future__ import annotations

import json
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


async def _stream_query(client: AsyncClient, payload: dict) -> tuple[int, dict, list[dict]]:
    """POST /query and collect the parsed SSE frames.

    Returns (status, headers, frames). Parsing is deliberately done by
    hand rather than with an SSE library: these tests are the contract
    check for the wire format, so they should fail if the framing
    changes, not quietly adapt to it.
    """
    frames: list[dict] = []
    async with client.stream("POST", "/api/v1/query", json=payload) as response:
        status = response.status_code
        headers = dict(response.headers)
        if status == 200:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    frames.append(json.loads(line[len("data: ") :]))
    return status, headers, frames


def _answer_of(frames: list[dict]) -> str:
    return "".join(f["text"] for f in frames if f["type"] == "token")


async def test_query_streams_token_frames_then_one_done_frame_with_sources(
    client, db_session, mock_claude_client
):
    """Acceptance: ingest a doc, ask a question answerable from it ->
    the answer arrives as >=1 token frame, followed by exactly one
    terminal done frame carrying the joined sources (hybrid mode)."""
    document_id = await _upload_solar_panels_doc(client)

    status, headers, frames = await _stream_query(
        client,
        {
            "question": "How do photovoltaic cells turn light into usable electrical power?",
            "top_k": 3,
            "mode": "hybrid",
        },
    )

    assert status == 200
    assert headers["content-type"].startswith("text/event-stream")
    # Without these a proxy can buffer the whole stream and the feature
    # silently stops being a stream in production.
    assert headers["cache-control"] == "no-cache"
    assert headers["x-accel-buffering"] == "no"

    token_frames = [f for f in frames if f["type"] == "token"]
    assert len(token_frames) >= 1
    # ...and genuinely incremental, not one blob wearing a token frame.
    assert len(token_frames) > 1
    assert _answer_of(frames) == mock_claude_client

    # exactly one terminal frame, and it is last
    assert [f["type"] for f in frames].count("done") == 1
    assert frames[-1]["type"] == "done"
    assert not any(f["type"] == "error" for f in frames)

    done = frames[-1]
    assert done["retrieval_mode"] == "hybrid"
    assert len(done["sources"]) > 0
    for source in done["sources"]:
        assert source["document"] == "retrieval_solar_panels.txt"
        assert source["chunk_id"]
        assert source["snippet"]

    # sanity: the uploaded document is the one actually cited
    doc_row = (
        await db_session.execute(
            text("SELECT id FROM documents WHERE id = :id"),
            {"id": document_id},
        )
    ).one()
    assert str(doc_row.id) == document_id
    assert all(s["document_id"] == document_id for s in done["sources"])


async def test_query_semantic_mode_streams_answer(client, mock_claude_client):
    """FR-15: semantic-only mode also completes the full loop."""
    await _upload_solar_panels_doc(client)

    status, _, frames = await _stream_query(
        client,
        {"question": "sunlight into electricity", "top_k": 3, "mode": "semantic"},
    )

    assert status == 200
    assert frames[-1]["type"] == "done"
    assert frames[-1]["retrieval_mode"] == "semantic"


async def test_done_frame_carries_retrieval_provenance_for_debug_view(
    client, mock_claude_client
):
    """FR-15: every source must carry the provenance the retrieval debug
    view renders -- which leg found it, and at what rank in each -- for
    single-leg modes as well as hybrid.

    Without this the debug view can only show a score, which is exactly
    what it isn't for: explaining semantic vs keyword contribution.
    """
    await _upload_solar_panels_doc(client)

    _, _, hybrid_frames = await _stream_query(
        client,
        {
            "question": "How do photovoltaic cells turn light into usable electrical power?",
            "top_k": 3,
            "mode": "hybrid",
        },
    )
    hybrid_sources = hybrid_frames[-1]["sources"]
    assert len(hybrid_sources) > 0

    for source in hybrid_sources:
        assert source["source"] in {"semantic", "keyword", "both"}
        # at least one leg must claim it, and source must agree with the ranks
        assert source["semantic_rank"] is not None or source["keyword_rank"] is not None
        if source["source"] == "both":
            assert source["semantic_rank"] is not None and source["keyword_rank"] is not None
        elif source["source"] == "semantic":
            assert source["keyword_rank"] is None
        else:
            assert source["semantic_rank"] is None
        # hybrid ranks by the RRF fused score: sum of 1/(60+rank) terms,
        # so strictly positive and never larger than the 2-leg maximum.
        assert 0 < source["score"] <= 2 / 61

    # results arrive pre-sorted best-first
    scores = [source["score"] for source in hybrid_sources]
    assert scores == sorted(scores, reverse=True)

    _, _, semantic_frames = await _stream_query(
        client,
        {"question": "sunlight into electricity", "top_k": 3, "mode": "semantic"},
    )
    semantic_sources = semantic_frames[-1]["sources"]
    assert len(semantic_sources) > 0
    # a semantic-only search can never attribute a chunk to the keyword leg
    assert all(s["source"] == "semantic" for s in semantic_sources)
    assert all(s["keyword_rank"] is None for s in semantic_sources)
    assert [s["semantic_rank"] for s in semantic_sources] == list(
        range(1, len(semantic_sources) + 1)
    )


async def test_query_with_no_documents_streams_graceful_refusal_not_error(client, db_session):
    """FR-10/NFR-3: with nothing ingested, retrieval yields no chunks at
    all -- the stream must carry a clean refusal and a done frame,
    never an error frame and never a 500.

    db_session is requested (though otherwise unused) purely for its
    truncate-before-yield side effect (see conftest.db_session) -- this
    test needs a genuinely empty documents/chunks table, which isn't
    guaranteed unless something in this test truncates it.
    """
    status, _, frames = await _stream_query(
        client,
        {"question": "What is the capital of France?", "mode": "hybrid"},
    )

    assert status == 200
    assert not any(f["type"] == "error" for f in frames)
    assert "cannot answer" in _answer_of(frames).lower()

    done = frames[-1]
    assert done["type"] == "done"
    assert done["sources"] == []
    # null on the refusal: no mode actually produced a ranking
    assert done["retrieval_mode"] is None


async def test_query_keyword_mode_off_topic_streams_graceful_refusal(client, db_session):
    """FR-10/NFR-3: keyword search on a query with no lexical match
    against ingested content also yields zero chunks -- same graceful
    refusal path, proven with a document actually present in the DB."""
    await _upload_solar_panels_doc(client)

    status, _, frames = await _stream_query(
        client,
        {"question": "zzznonexistentqueryterm", "mode": "keyword"},
    )

    assert status == 200
    assert "cannot answer" in _answer_of(frames).lower()
    assert frames[-1]["type"] == "done"
    assert frames[-1]["sources"] == []


async def test_claude_refusal_is_streamed_verbatim_with_context_sources(client, monkeypatch):
    """The off-topic-with-context refusal path: hybrid search still
    surfaces its nearest (irrelevant) chunks -- prompt_builder's
    context-only instruction is what makes Claude itself decline, not
    an empty-retrieval short-circuit. Simulates that declined answer
    and confirms it flows through untouched, with real sources
    attached, never a 500 or a fabricated answer."""
    refusal_text = "I cannot answer this question based on the available documents."

    async def _fake_stream(prompt: str):
        yield refusal_text

    monkeypatch.setattr("app.generation.claude_client.stream", _fake_stream)

    await _upload_solar_panels_doc(client)

    status, _, frames = await _stream_query(
        client,
        {"question": "What is the best way to train a parrot?", "mode": "hybrid"},
    )

    assert status == 200
    assert _answer_of(frames) == refusal_text
    # retrieval still ran and returned its nearest (irrelevant) chunks --
    # this is the point of the design: Claude refuses, plumbing doesn't 500.
    assert frames[-1]["type"] == "done"
    assert len(frames[-1]["sources"]) > 0


async def test_generation_failure_streams_error_frame_instead_of_done(client, monkeypatch):
    """NFR-3: once the 200 is committed there is no way to send a 502,
    so an upstream failure must arrive as a terminal error frame --
    and must not be followed by a done frame that would let the client
    treat a failed answer as complete."""
    from app.core.exceptions import UpstreamAPIError

    async def _failing_stream(prompt: str):
        yield "partial "
        raise UpstreamAPIError("Claude API call failed: boom")

    monkeypatch.setattr("app.generation.claude_client.stream", _failing_stream)

    await _upload_solar_panels_doc(client)

    status, _, frames = await _stream_query(
        client,
        {"question": "How do photovoltaic cells work?", "mode": "hybrid"},
    )

    assert status == 200
    assert frames[-1]["type"] == "error"
    assert "boom" in frames[-1]["message"]
    assert not any(f["type"] == "done" for f in frames)


async def test_cors_allows_the_frontend_origin_on_the_stream(client, mock_claude_client):
    """The dev frontend is a different origin (Vite on :5173) whenever
    VITE_API_BASE_URL bypasses the proxy, and a streaming response is
    still subject to CORS -- the browser rejects the whole stream
    without these headers, so they are part of this endpoint's
    contract, not incidental middleware behavior."""
    await _upload_solar_panels_doc(client)

    origin = "http://localhost:5173"

    preflight = await client.options(
        "/api/v1/query",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.headers["access-control-allow-origin"] == origin

    async with client.stream(
        "POST",
        "/api/v1/query",
        json={"question": "sunlight into electricity", "mode": "hybrid"},
        headers={"Origin": origin},
    ) as response:
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert response.headers["content-type"].startswith("text/event-stream")
        await response.aread()
