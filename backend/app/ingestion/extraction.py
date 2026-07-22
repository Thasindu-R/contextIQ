"""Text extraction.

Single responsibility (NFR-5): extract raw text from PDF/plain-text
files while preserving page boundaries (FR-2). No chunking or
embedding logic here.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExtractedPage:
    """Raw extracted text for a single page."""

    page_number: int
    text: str


def extract_text(file_path: str, mime_type: str) -> list[ExtractedPage]:
    """Extract text per page from a PDF or plain-text file (FR-2).

    TODO: branch on mime_type ("application/pdf" vs "text/plain"),
    parse accordingly (e.g. pypdf for PDF), return one ExtractedPage
    per page (plain text treated as a single page). Raise
    UnsupportedFileType for anything else.
    """
    raise NotImplementedError
