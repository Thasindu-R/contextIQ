"""Tests for the ingestion pipeline (extraction, chunking, embedding).

Single responsibility (NFR-5): verify ingestion.pipeline, extraction,
chunking, and embedding modules behave correctly in isolation and
end-to-end against fixture documents.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest
from pypdf import PdfWriter

from app.core.exceptions import (
    CorruptDocumentError,
    EmptyDocumentError,
    EncryptedDocumentError,
    UnsupportedFileType,
)
from app.ingestion.chunking import chunk_pages
from app.ingestion.embedding import EMBEDDING_DIM, load_model
from app.ingestion.extraction import (
    PDF_MIME_TYPE,
    TEXT_MIME_TYPE,
    ExtractedPage,
    extract_text,
)

# A real paraphrase pair should score much closer than an unrelated pair;
# this threshold is far below the ~0.95 observed for all-MiniLM-L6-v2, so
# it only trips if normalization/encoding is actually broken.
MIN_SIMILARITY_MARGIN = 0.3

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_PDF = FIXTURES_DIR / "sample_multipage.pdf"

# Known per-page markers baked into fixtures/sample_multipage.pdf, in order.
SAMPLE_PDF_MARKERS = [
    "ALPHA_MARKER_PAGE_ONE",
    "BETA_MARKER_PAGE_TWO",
    "GAMMA_MARKER_PAGE_THREE",
]


def test_extract_pdf_page_count_matches_source():
    """FR-2: extraction should return one ExtractedPage per source page."""
    pages = extract_text(str(SAMPLE_PDF), PDF_MIME_TYPE)

    assert isinstance(pages, list)
    assert len(pages) == len(SAMPLE_PDF_MARKERS) == 3


@pytest.mark.parametrize(
    ("expected_page_number", "marker"),
    list(enumerate(SAMPLE_PDF_MARKERS, start=1)),
)
def test_extract_pdf_known_string_on_correct_page(expected_page_number, marker):
    """FR-2: each page's known marker string must appear on that page only."""
    pages = extract_text(str(SAMPLE_PDF), PDF_MIME_TYPE)

    page = next(p for p in pages if p.page_number == expected_page_number)
    assert marker in page.text

    other_pages = [p for p in pages if p.page_number != expected_page_number]
    assert all(marker not in p.text for p in other_pages)


def test_extract_txt_returns_single_page(tmp_path):
    """Plain text is treated as a single page, never split or blobbed."""
    txt_path = tmp_path / "note.txt"
    txt_path.write_text("hello from a plain text fixture", encoding="utf-8")

    pages = extract_text(str(txt_path), TEXT_MIME_TYPE)

    assert len(pages) == 1
    assert pages[0].page_number == 1
    assert pages[0].text == "hello from a plain text fixture"


def test_extract_unsupported_mime_type_raises(tmp_path):
    path = tmp_path / "image.png"
    path.write_bytes(b"not really a png")

    with pytest.raises(UnsupportedFileType):
        extract_text(str(path), "image/png")


def test_extract_corrupt_pdf_raises_corrupt_document_error(tmp_path):
    """A file that isn't valid PDF structure must raise a typed error,
    not propagate a raw pypdf/library exception."""
    corrupt_path = tmp_path / "corrupt.pdf"
    corrupt_path.write_bytes(b"%PDF-1.4\nthis is not a real pdf structure\n%%EOF")

    with pytest.raises(CorruptDocumentError):
        extract_text(str(corrupt_path), PDF_MIME_TYPE)


def test_extract_scanned_pdf_raises_empty_document_error(tmp_path):
    """A PDF with no text layer at all (stand-in for a scanned-image PDF,
    since OCR is out of scope) must raise a typed error."""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_blank_page(width=200, height=200)

    scanned_path = tmp_path / "scanned.pdf"
    with open(scanned_path, "wb") as f:
        writer.write(f)

    with pytest.raises(EmptyDocumentError):
        extract_text(str(scanned_path), PDF_MIME_TYPE)


def test_extract_encrypted_pdf_raises_encrypted_document_error(tmp_path):
    """A password-protected PDF must raise a typed error rather than
    crashing or silently returning garbage."""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt(user_password="secret123", owner_password=None, algorithm="AES-256")

    encrypted_path = tmp_path / "encrypted.pdf"
    with open(encrypted_path, "wb") as f:
        writer.write(f)

    with pytest.raises(EncryptedDocumentError):
        extract_text(str(encrypted_path), PDF_MIME_TYPE)


def test_chunk_pages_respects_overlap():
    """FR-3: chunk boundaries should honor configured size/overlap."""
    pages = [ExtractedPage(page_number=1, text="abcdefghij")]  # 10 chars

    chunks = chunk_pages(pages, chunk_size=4, chunk_overlap=2)

    assert [c.text for c in chunks] == ["abcd", "cdef", "efgh", "ghij"]
    assert [c.chunk_index for c in chunks] == [0, 1, 2, 3]
    assert all(c.page == 1 for c in chunks)


def test_chunk_pages_indexes_sequentially_across_pages():
    """chunk_index must keep incrementing across page boundaries, and
    chunks must never span two pages."""
    pages = [
        ExtractedPage(page_number=1, text="hello"),
        ExtractedPage(page_number=2, text="world"),
    ]

    chunks = chunk_pages(pages, chunk_size=10, chunk_overlap=0)

    assert [(c.page, c.text, c.chunk_index) for c in chunks] == [
        (1, "hello", 0),
        (2, "world", 1),
    ]


@pytest.fixture(scope="module")
def embedding_service():
    """Loads the real all-MiniLM-L6-v2 model once for this test module."""
    return load_model("all-MiniLM-L6-v2")


def test_embed_texts_returns_384_dim_vectors(embedding_service):
    """FR-4: every embedding must be a 384-dim vector (all-MiniLM-L6-v2)."""
    vectors = embedding_service.embed_texts(["hello world", "a second sentence"])

    assert len(vectors) == 2
    for vector in vectors:
        assert len(vector) == EMBEDDING_DIM == 384


def test_embed_texts_vectors_are_l2_normalized(embedding_service):
    """normalize_embeddings=True must hold: every vector has L2 norm ~= 1.0,
    so cosine distance matches what the pgvector index computes."""
    vectors = embedding_service.embed_texts(
        [
            "The quick brown fox jumps over the lazy dog.",
            "Completely different sentence about quarterly finance.",
            "",  # edge case: empty string must not produce a zero/garbage vector
        ]
    )

    for vector in vectors:
        norm = math.sqrt(sum(x * x for x in vector))
        assert norm == pytest.approx(1.0, abs=1e-3)


def test_paraphrase_pair_more_similar_than_unrelated_pair(embedding_service):
    """A paraphrase must score a clear margin above an unrelated sentence,
    or retrieval quality is silently broken."""
    anchor = "The cat sat on the mat."
    paraphrase = "A cat was sitting on the mat."
    unrelated = "Quarterly revenue exceeded analyst expectations this fiscal year."

    anchor_vec, paraphrase_vec, unrelated_vec = embedding_service.embed_texts(
        [anchor, paraphrase, unrelated]
    )

    def cosine(a: list[float], b: list[float]) -> float:
        # Vectors are already L2-normalized, so cosine similarity reduces
        # to a plain dot product.
        return sum(x * y for x, y in zip(a, b, strict=True))

    similarity_paraphrase = cosine(anchor_vec, paraphrase_vec)
    similarity_unrelated = cosine(anchor_vec, unrelated_vec)

    assert similarity_paraphrase - similarity_unrelated > MIN_SIMILARITY_MARGIN, (
        f"expected a clear margin: paraphrase={similarity_paraphrase:.4f} "
        f"unrelated={similarity_unrelated:.4f}"
    )


def test_lifespan_loads_embedding_service_once_at_startup(monkeypatch):
    """The model must be loaded via the FastAPI lifespan at startup, not
    lazily per call — verified by driving the app through its actual
    startup event and checking app.state is populated."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-ant-test-placeholder")

    from app.core.config import get_settings

    get_settings.cache_clear()

    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    assert not hasattr(app.state, "embedding_service")

    with TestClient(app):
        vectors = app.state.embedding_service.embed_texts(["startup check"])
        assert len(vectors[0]) == EMBEDDING_DIM

    get_settings.cache_clear()
