"""FastAPI entrypoint.

Single responsibility (NFR-5): construct the FastAPI app, register the
v1 API router, configure CORS, and install global exception handlers.
Contains no business logic, SQL, or model code.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Application factory.

    TODO: instantiate FastAPI(), configure CORS middleware from
    core.config.Settings, register the /api/v1 router, register
    exception handlers from core.exceptions, and return the app.
    """
    raise NotImplementedError


app: FastAPI = create_app()
