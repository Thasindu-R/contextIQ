"""v1 API router aggregation.

Single responsibility (NFR-5): mount the documents, query, and health
routers under /api/v1. Contains no route logic itself.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import documents, health, query

router = APIRouter(prefix="/api/v1")

# TODO: router.include_router(documents.router)
# TODO: router.include_router(query.router)
# TODO: router.include_router(health.router)
