"""Database engine and session management.

Single responsibility (NFR-5): own the async SQLAlchemy engine,
session factory, and pgvector type registration. No other module
should construct engines or sessions directly.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession


def get_engine():
    """Construct (or return a cached) async SQLAlchemy engine.

    TODO: build engine from Settings.database_url, register the
    pgvector type adapter for the async driver.
    """
    raise NotImplementedError


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a scoped AsyncSession.

    TODO: yield a session from an async session factory bound to
    get_engine(), ensuring proper close/rollback semantics.
    """
    raise NotImplementedError
