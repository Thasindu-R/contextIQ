"""Week 1 sign-off integration test.

Per the project timeline (Week 1 = "Ingestion Pipeline ... verified
via direct API calls"): ingest both fixture documents through the
HTTP API only, against a clean database, then verify persisted state
directly against Postgres — including a raw to_tsquery sanity query
that proves content_tsv is genuinely queryable, not merely non-null.
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.models.chunk import Chunk

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_PDF = FIXTURES_DIR / "sample_multipage.pdf"
SAMPLE_TXT = FIXTURES_DIR / "sample_document.txt"

# Deliberately rare token baked into sample_document.txt (see that file)
# so a to_tsquery hit can only be genuine, not a stemmed-common-word fluke.
TSQUERY_SANITY_WORD = "wombat"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


async def _upload(client: AsyncClient, path: Path, mime_type: str) -> tuple[dict, float]:
    """POST one fixture file and return (response JSON, wall-clock seconds).

    The endpoint accepts a batch (FR-1: "one or more") and always
    returns a list -- this helper posts a single-file batch and
    unwraps the one resulting DocumentOut for callers that only care
    about one document at a time.
    """
    with open(path, "rb") as f:
        start = time.perf_counter()
        response = await client.post(
            "/api/v1/documents",
            files={"files": (path.name, f, mime_type)},
        )
        elapsed = time.perf_counter() - start
    assert response.status_code == 201, response.text
    return response.json()[0], elapsed


async def test_week1_signoff_ingestion_pipeline(client, db_session):
    """Week 1 milestone: upload -> extract -> chunk -> embed -> pgvector
    + tsvector storage, verified end-to-end via the HTTP API only,
    against a clean database (db_session truncates documents/chunks
    before this test runs)."""

    pdf_body, pdf_elapsed = await _upload(client, SAMPLE_PDF, "application/pdf")
    txt_body, txt_elapsed = await _upload(client, SAMPLE_TXT, "text/plain")
    documents = [pdf_body, txt_body]

    # 1. documents rows exist with correct status
    for doc in documents:
        assert doc["status"] == "ready"
        row = (
            await db_session.execute(
                text("SELECT status, page_count FROM documents WHERE id = :id"),
                {"id": doc["id"]},
            )
        ).one()
        assert row.status == "ready"
        assert row.page_count == doc["page_count"]

    all_chunks = (
        (await db_session.execute(select(Chunk).order_by(Chunk.document_id, Chunk.chunk_index)))
        .scalars()
        .all()
    )
    chunks_by_doc: dict[str, list[Chunk]] = {}
    for chunk in all_chunks:
        chunks_by_doc.setdefault(str(chunk.document_id), []).append(chunk)

    chunk_lengths: list[int] = []
    for doc in documents:
        doc_chunks = chunks_by_doc.get(doc["id"], [])

        # 2. chunk counts non-zero, chunk_index contiguous from 0
        assert len(doc_chunks) > 0, f"no chunks persisted for {doc['filename']!r}"
        assert [c.chunk_index for c in doc_chunks] == list(range(len(doc_chunks)))

        # 5. page_number values fall within the document's real page range
        for c in doc_chunks:
            assert 1 <= c.page_number <= doc["page_count"], (
                f"{doc['filename']!r} chunk {c.chunk_index} has page_number "
                f"{c.page_number}, outside 1..{doc['page_count']}"
            )
            chunk_lengths.append(len(c.content))

    # 3. zero chunks with NULL embedding or NULL content_tsv (global —
    # only these two documents' chunks exist in the table right now)
    null_count = (
        await db_session.execute(
            text("SELECT count(*) FROM chunks WHERE embedding IS NULL OR content_tsv IS NULL")
        )
    ).scalar_one()
    assert null_count == 0

    # 4. every embedding has 384 dimensions
    for chunk in all_chunks:
        assert chunk.embedding is not None
        assert len(chunk.embedding) == 384

    # 6. raw to_tsquery sanity query: proves content_tsv is genuinely
    # queryable, not just populated
    tsquery_hits = (
        await db_session.execute(
            text("SELECT count(*) FROM chunks WHERE content_tsv @@ to_tsquery('english', :word)"),
            {"word": TSQUERY_SANITY_WORD},
        )
    ).scalar_one()
    assert tsquery_hits > 0, f"expected a to_tsquery hit for {TSQUERY_SANITY_WORD!r}"

    await db_session.commit()

    total_chunks = len(all_chunks)
    mean_chunk_length = sum(chunk_lengths) / len(chunk_lengths)
    total_pages = sum(doc["page_count"] for doc in documents)
    mean_ms_per_page = (pdf_elapsed + txt_elapsed) / total_pages * 1000

    print("\n=== Week 1 Sign-off Summary ===")
    print(f"Documents ingested:           {len(documents)}")
    print(f"Total chunks:                 {total_chunks}")
    print(f"Mean chunk length:            {mean_chunk_length:.1f} chars")
    print(f"Mean ingestion time per page: {mean_ms_per_page:.1f} ms/page")
