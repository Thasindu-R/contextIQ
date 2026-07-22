"""FastAPI entrypoint.

Single responsibility (NFR-5): construct the FastAPI app, register the
v1 API router, configure CORS, and install global exception handlers.
Contains no business logic, SQL, or model code.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.exceptions import ExtractionError, FileTooLargeError, UnsupportedFileType
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


def _domain_error_handler(status_code: int):
    """Build a handler mapping one exception type (or family, via a
    shared base class) to a fixed status code with the exception's
    message as the body (NFR-3: clean 4xx, never a 500 stack trace)."""

    async def handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=status_code, content={"detail": str(exc)})

    return handler


def create_app() -> FastAPI:
    """Application factory.

    TODO: configure CORS middleware once allowed origins are pinned
    down.
    """
    app = FastAPI(lifespan=lifespan)
    app.include_router(v1_router)

    # Domain exception -> HTTP status mapping (NFR-3). ExtractionError
    # is a base class (CorruptDocumentError, EncryptedDocumentError,
    # EmptyDocumentError), so registering it once covers all three.
    app.add_exception_handler(UnsupportedFileType, _domain_error_handler(415))
    app.add_exception_handler(FileTooLargeError, _domain_error_handler(413))
    app.add_exception_handler(ExtractionError, _domain_error_handler(422))

    return app


app: FastAPI = create_app()
