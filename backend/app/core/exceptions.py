"""Domain exceptions.

Single responsibility (NFR-3/NFR-5): define the application's typed
error taxonomy so services raise semantic exceptions instead of
leaking library-specific errors, and main.py can map them to HTTP
responses in one place.
"""
from __future__ import annotations


class ContextIQError(Exception):
    """Base class for all domain-specific errors."""


class UnsupportedFileType(ContextIQError):
    """Raised when an uploaded document's mime type is not supported (FR-1)."""


class UpstreamAPIError(ContextIQError):
    """Raised when a call to an external API (e.g. Claude) fails (NFR-3)."""


class NoContextFound(ContextIQError):
    """Raised when retrieval yields no usable chunks for a query (FR-10)."""
