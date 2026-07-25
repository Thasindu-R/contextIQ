"""Pytest fixtures.

Single responsibility (NFR-5): shared test fixtures — an isolated test
DB session, sample documents/chunks, and a mock Claude client — used
across test_ingestion.py, test_retrieval.py, test_generation.py,
test_documents_api.py.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.core.database import get_engine, get_session_factory
from app.models.document import Document


@pytest.fixture(autouse=True)
async def _reset_db_engine_between_tests():
    """Dispose and clear the cached engine/session-factory after each test.

    get_engine()/get_session_factory() are process-wide lru_cache'd
    singletons (by design — the app should only ever build one), but
    pytest-asyncio gives each async test its own event loop by
    default, and an asyncpg connection pool is bound to whichever loop
    created it. Without this, the second DB-touching test would hand
    its queries to a pool still attached to the first test's
    already-closed loop.
    """
    yield
    engine = get_engine()
    await engine.dispose()
    get_engine.cache_clear()
    get_session_factory.cache_clear()


@pytest.fixture
async def db_session():
    """Yield an async SQLAlchemy session bound to the test database
    (DATABASE_URL), truncating documents/chunks first so each test
    starts from a clean slate.

    Requires DATABASE_URL to point at a Postgres+pgvector instance
    with the ingestion schema migration already applied
    (`alembic upgrade head`).
    """
    session_factory = get_session_factory()
    async with session_factory() as session:
        async with session.begin():
            await session.execute(text("TRUNCATE documents, chunks CASCADE"))
        yield session


@pytest.fixture
def sample_document():
    """A minimal in-memory Document fixture, not persisted to the DB."""
    return Document(
        id=uuid.uuid4(),
        filename="sample_document.txt",
        status="ready",
        page_count=1,
    )


MOCK_ANSWER = "This is a mocked Claude response."


@pytest.fixture
def mock_claude_client(monkeypatch):
    """Patch generation.claude_client.generate with a deterministic stub,
    avoiding real network calls in tests that exercise qa_service /
    the query endpoint end-to-end."""

    async def _fake_generate(prompt: str) -> str:
        return MOCK_ANSWER

    monkeypatch.setattr("app.generation.claude_client.generate", _fake_generate)
    return MOCK_ANSWER
