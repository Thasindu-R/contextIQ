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


class CorruptDocumentError(ContextIQError):
    """Raised when a document's bytes cannot be parsed as a valid file of its
    declared type (FR-2, NFR-3), e.g. a malformed or truncated PDF."""


class EncryptedDocumentError(ContextIQError):
    """Raised when a PDF is password-protected and cannot be read without a
    password the system does not have (FR-2, NFR-3)."""


class EmptyDocumentError(ContextIQError):
    """Raised when extraction yields no extractable text at all, e.g. a
    scanned-image PDF with no text layer (FR-2, NFR-3). OCR is out of scope,
    so such documents cannot be ingested."""


class UpstreamAPIError(ContextIQError):
    """Raised when a call to an external API (e.g. Claude) fails (NFR-3)."""


class NoContextFound(ContextIQError):
    """Raised when retrieval yields no usable chunks for a query (FR-10)."""
