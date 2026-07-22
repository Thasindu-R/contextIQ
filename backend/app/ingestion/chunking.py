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

    A fixed-size sliding window over each page's text independently
    (chunks never span a page boundary, so citations stay page-exact).
    chunk_index is sequential across the whole document, not reset
    per page.
    """
    step = max(chunk_size - chunk_overlap, 1)
    chunks: list[TextChunk] = []
    index = 0

    for page in pages:
        text = page.text
        length = len(text)
        start = 0
        while start < length:
            end = min(start + chunk_size, length)
            piece = text[start:end]
            if piece.strip():
                chunks.append(TextChunk(text=piece, page=page.page_number, chunk_index=index))
                index += 1
            if end == length:
                break
            start += step

    return chunks
