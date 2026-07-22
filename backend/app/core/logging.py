"""Structured logging configuration.

Single responsibility (NFR-3/NFR-5): configure a single, consistent
structured logging setup used across the application (request IDs,
log levels, JSON formatting for production).
"""
from __future__ import annotations

import logging


def configure_logging() -> None:
    """Configure root logging handlers/formatters.

    TODO: set up structured (JSON) logging with request-scoped
    context (e.g. request id), driven by Settings.log_level.
    """
    raise NotImplementedError


def get_logger(name: str) -> logging.Logger:
    """Return a module-scoped logger.

    TODO: return logging.getLogger(name) after configure_logging()
    has been called at startup.
    """
    raise NotImplementedError
