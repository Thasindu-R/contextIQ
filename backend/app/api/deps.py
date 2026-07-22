"""FastAPI dependency providers.

Single responsibility (NFR-5): wire DB sessions, settings, and service
instances for injection into route handlers. Keeps route modules free
of construction logic.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.ingestion.embedding import EmbeddingService


async def get_db(session: AsyncSession = ...) -> AsyncGenerator[AsyncSession, None]:
    """Yield a DB session for request scope.

    TODO: delegate to core.database.get_session.
    """
    raise NotImplementedError


def get_app_settings() -> Settings:
    """Return the cached Settings instance.

    TODO: delegate to core.config.get_settings.
    """
    raise NotImplementedError


def get_embedding_service(request: Request) -> EmbeddingService:
    """Return the app-lifetime EmbeddingService loaded at startup (FR-4).

    Never constructs a new one here — the model is loaded exactly
    once, by app.main's lifespan, and shared via app.state.
    """
    return request.app.state.embedding_service
