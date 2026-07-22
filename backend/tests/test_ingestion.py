"""Tests for the ingestion pipeline (extraction, chunking, embedding).

Single responsibility (NFR-5): verify ingestion.pipeline, extraction,
chunking, and embedding modules behave correctly in isolation and
end-to-end against fixture documents.
"""
from __future__ import annotations


def test_extract_text_preserves_page_boundaries():
    """FR-2: extraction should return one ExtractedPage per source page.

    TODO: implement once extraction.extract_text is implemented.
    """
    raise NotImplementedError


def test_chunk_pages_respects_overlap():
    """FR-3: chunk boundaries should honor configured size/overlap.

    TODO: implement once chunking.chunk_pages is implemented.
    """
    raise NotImplementedError
