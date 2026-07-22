"""Health check routes.

Single responsibility (NFR-5): liveness and readiness probes. The
readiness check verifies DB connectivity; no other business logic.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/livez")
async def liveness() -> dict[str, str]:
    """Process is up.

    TODO: return {"status": "ok"}
    """
    raise NotImplementedError


@router.get("/readyz")
async def readiness() -> dict[str, str]:
    """Process is up and dependencies (DB) are reachable.

    TODO: attempt a trivial DB query via core.database; return status.
    """
    raise NotImplementedError
