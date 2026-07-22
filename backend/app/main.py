"""FastAPI entrypoint.

Single responsibility (NFR-5): construct the FastAPI app, register the
v1 API router, configure CORS, and install global exception handlers.
Contains no business logic, SQL, or model code.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.ingestion.embedding import load_model


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load the embedding model once at startup (FR-4), not per call.

    Model loading is blocking CPU/disk work, so it's run in a worker
    thread rather than inline, to avoid stalling the startup event
    loop. The resulting EmbeddingService is shared for the app's
    lifetime via app.state (see api.deps.get_embedding_service).
    """
    settings = get_settings()
    app.state.embedding_service = await asyncio.to_thread(load_model, settings.embedding_model)
    yield


def create_app() -> FastAPI:
    """Application factory.

    TODO: configure CORS middleware and register global exception
    handlers from core.exceptions once those requirements are pinned
    down (allowed origins, exception -> status code mapping).
    """
    app = FastAPI(lifespan=lifespan)
    app.include_router(v1_router)
    return app


app: FastAPI = create_app()
