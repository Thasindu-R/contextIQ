"""Chunking.

Single responsibility (NFR-5): split extracted page text into
overlapping chunks suitable for embedding (FR-3). No extraction or
embedding logic here.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.ingestion.extraction import ExtractedPage


@dataclass
class TextChunk:
    """A chunk of text ready for embedding."""

    text: str
    page: int | None
    chunk_index: int


def chunk_pages(pages: list[ExtractedPage], chunk_size: int, chunk_overlap: int) -> list[TextChunk]:
    """Split pages into overlapping chunks (FR-3).

    TODO: implement a sliding-window splitter over each page's text
    using chunk_size and chunk_overlap, assigning sequential
    chunk_index values.
    """
    raise NotImplementedError
