"""Health check routes.

Single responsibility (NFR-5): liveness and readiness probes. The
readiness check verifies DB connectivity and that the embedding model
has been loaded; no other business logic.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db

router = APIRouter(tags=["health"])


@router.get("/livez")
async def liveness() -> dict[str, str]:
    """Process is up."""
    return {"status": "ok"}


@router.get("/readyz")
async def readiness(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Process is up and dependencies (DB, embedding model) are reachable."""
    await session.execute(text("SELECT 1"))
    embedding_service = getattr(request.app.state, "embedding_service", None)
    if embedding_service is None:
        return {"status": "not_ready", "reason": "embedding model not loaded"}
    return {"status": "ok"}
