"""Database engine and session management.

Single responsibility (NFR-5): own the async SQLAlchemy engine,
session factory, and declarative Base. No other module should
construct engines or sessions directly.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models (models/document.py,
    models/chunk.py)."""


@lru_cache
def get_engine() -> AsyncEngine:
    """Construct (and cache) the async SQLAlchemy engine.

    The connection URL comes from Settings (NFR-7) — never read
    os.environ directly here or anywhere else.
    """
    return create_async_engine(get_settings().database_url)


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the cached session factory bound to `get_engine()`."""
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a scoped AsyncSession.

    Does not open a transaction itself — callers needing atomicity
    across multiple writes (e.g. inserting a document and its chunks
    together) use `async with session.begin()` explicitly. See
    services.document_service.upload_document.
    """
    async with get_session_factory()() as session:
        yield session
