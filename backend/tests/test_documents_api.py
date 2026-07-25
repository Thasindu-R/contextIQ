"""End-to-end tests for the document upload endpoint (FR-1..FR-5).

Drives the real FastAPI app over ASGI (so the real embedding model
loads via the actual lifespan) against a real Postgres+pgvector test
database (DATABASE_URL, migrated via `alembic upgrade head`), then
asserts on persisted rows directly.

Uses httpx.AsyncClient over ASGITransport, with the app's lifespan
entered manually on the *same* event loop as the test, rather than
Starlette's TestClient (which runs the app in a separate thread with
its own event loop) — the app's DB engine and this test's db_session
fixture share one cached engine (see conftest.py), and asyncpg
connections can't cross event loops.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.models.chunk import Chunk

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_PDF = FIXTURES_DIR / "sample_multipage.pdf"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac


async def test_upload_pdf_persists_document_and_chunks_with_embeddings(client, db_session):
    with open(SAMPLE_PDF, "rb") as f:
        response = await client.post(
            "/api/v1/documents",
            files={"files": ("sample_multipage.pdf", f, "application/pdf")},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body) == 1
    assert body[0]["status"] == "ready"
    assert body[0]["page_count"] == 3

    document_id = body[0]["id"]

    doc_row = (
        await db_session.execute(
            text("SELECT status, page_count FROM documents WHERE id = :id"),
            {"id": document_id},
        )
    ).one()
    assert doc_row.status == "ready"
    assert doc_row.page_count == 3

    chunks = (
        (
            await db_session.execute(
                select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.embedding is not None
        assert len(chunk.embedding) == 384

    tsv_populated_count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM chunks "
                "WHERE document_id = :id AND content_tsv IS NOT NULL"
            ),
            {"id": document_id},
        )
    ).scalar_one()
    assert tsv_populated_count == len(chunks)


async def test_upload_docx_rejected_with_415(client):
    response = await client.post(
        "/api/v1/documents",
        files={
            "files": (
                "report.docx",
                b"fake docx bytes",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert response.status_code == 415


async def test_upload_corrupt_pdf_rejected_and_leaves_no_rows(client, db_session):
    corrupt_bytes = b"%PDF-1.4\nthis is not a real pdf structure\n%%EOF"

    response = await client.post(
        "/api/v1/documents",
        files={"files": ("corrupt.pdf", corrupt_bytes, "application/pdf")},
    )

    assert 400 <= response.status_code < 500, response.text

    doc_count = (await db_session.execute(text("SELECT count(*) FROM documents"))).scalar_one()
    chunk_count = (await db_session.execute(text("SELECT count(*) FROM chunks"))).scalar_one()
    assert doc_count == 0
    assert chunk_count == 0


async def test_upload_accepts_multiple_files(client):
    with open(SAMPLE_PDF, "rb") as f:
        response = await client.post(
            "/api/v1/documents",
            files=[
                ("files", ("sample_multipage.pdf", f.read(), "application/pdf")),
                ("files", ("sample_document.txt", b"Plain text content.", "text/plain")),
            ],
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body) == 2
    assert {doc["status"] for doc in body} == {"ready"}


async def test_list_documents_returns_uploaded_documents(client):
    with open(SAMPLE_PDF, "rb") as f:
        upload_response = await client.post(
            "/api/v1/documents",
            files={"files": ("sample_multipage.pdf", f, "application/pdf")},
        )
    uploaded_id = upload_response.json()[0]["id"]

    response = await client.get("/api/v1/documents")

    assert response.status_code == 200
    assert any(doc["id"] == uploaded_id for doc in response.json())


async def test_delete_document_removes_document_and_cascades_chunks(client, db_session):
    with open(SAMPLE_PDF, "rb") as f:
        upload_response = await client.post(
            "/api/v1/documents",
            files={"files": ("sample_multipage.pdf", f, "application/pdf")},
        )
    document_id = upload_response.json()[0]["id"]

    response = await client.delete(f"/api/v1/documents/{document_id}")

    assert response.status_code == 204

    doc_count = (
        await db_session.execute(
            text("SELECT count(*) FROM documents WHERE id = :id"), {"id": document_id}
        )
    ).scalar_one()
    chunk_count = (
        await db_session.execute(
            text("SELECT count(*) FROM chunks WHERE document_id = :id"), {"id": document_id}
        )
    ).scalar_one()
    assert doc_count == 0
    assert chunk_count == 0
