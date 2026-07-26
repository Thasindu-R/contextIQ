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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.exceptions import (
    ExtractionError,
    FileTooLargeError,
    UnsupportedFileType,
    UpstreamAPIError,
)
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
    """Application factory."""
    app = FastAPI(lifespan=lifespan)

    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(v1_router)

    # Domain exception -> HTTP status mapping (NFR-3). ExtractionError
    # is a base class (CorruptDocumentError, EncryptedDocumentError,
    # EmptyDocumentError), so registering it once covers all three.
    app.add_exception_handler(UnsupportedFileType, _domain_error_handler(415))
    app.add_exception_handler(FileTooLargeError, _domain_error_handler(413))
    app.add_exception_handler(ExtractionError, _domain_error_handler(422))
    # UpstreamAPIError still maps to 502 for any pre-response failure.
    # It cannot for a *generation* failure: /query streams, so by the
    # time Claude fails the status line is already sent -- qa_service
    # reports that in-band, as an `error` frame (see api/v1/query.py).
    #
    # FR-10 (retrieval found nothing) likewise has no handler: it is a
    # successful, well-formed answer, emitted as the refusal sentence
    # plus a `done` frame with no sources, not an exception.
    app.add_exception_handler(UpstreamAPIError, _domain_error_handler(502))

    return app


app: FastAPI = create_app()
