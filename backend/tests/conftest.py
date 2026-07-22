"""Pytest fixtures.

Single responsibility (NFR-5): shared test fixtures — an isolated test
DB session, sample documents/chunks, and a mock Claude client — used
across test_ingestion.py, test_retrieval.py, test_generation.py.
"""
from __future__ import annotations

import pytest


@pytest.fixture
async def db_session():
    """Yield an async SQLAlchemy session bound to a test database.

    TODO: spin up/point at a test Postgres instance with pgvector,
    run migrations/init.sql, yield a session, roll back after.
    """
    raise NotImplementedError


@pytest.fixture
def sample_document():
    """A minimal in-memory Document fixture.

    TODO: return a Document instance (or factory) for use in tests.
    """
    raise NotImplementedError


@pytest.fixture
def mock_claude_client(monkeypatch):
    """Patch generation.claude_client.generate with a deterministic stub.

    TODO: monkeypatch generate() to return a fixed string, avoiding
    real network calls in tests.
    """
    raise NotImplementedError
