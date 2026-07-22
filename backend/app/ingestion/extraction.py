"""Text extraction.

Single responsibility (NFR-5): extract raw text from PDF/plain-text
files while preserving page boundaries (FR-2). No chunking or
embedding logic here.
"""
from __future__ import annotations

from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import DependencyError, PdfReadError

from app.core.exceptions import (
    CorruptDocumentError,
    EmptyDocumentError,
    EncryptedDocumentError,
    UnsupportedFileType,
)

PDF_MIME_TYPE = "application/pdf"
TEXT_MIME_TYPE = "text/plain"


@dataclass
class ExtractedPage:
    """Raw extracted text for a single page."""

    page_number: int
    text: str


def extract_text(file_path: str, mime_type: str) -> list[ExtractedPage]:
    """Extract text per page from a PDF or plain-text file (FR-2).

    Always returns one ExtractedPage per source page (plain text is
    treated as a single page) — never a single concatenated blob.

    Raises:
        UnsupportedFileType: mime_type is neither PDF nor plain text.
        CorruptDocumentError: the file cannot be parsed as a valid
            document of its declared type.
        EncryptedDocumentError: the PDF is password-protected and its
            content is not accessible without a password.
        EmptyDocumentError: extraction succeeded but yielded no text
            at all (e.g. a scanned-image PDF; OCR is out of scope).
    """
    if mime_type == PDF_MIME_TYPE:
        return _extract_pdf(file_path)
    if mime_type == TEXT_MIME_TYPE:
        return _extract_plain_text(file_path)
    raise UnsupportedFileType(f"Unsupported mime type: {mime_type!r}")


def _extract_pdf(file_path: str) -> list[ExtractedPage]:
    try:
        reader = PdfReader(file_path)
    except PdfReadError as exc:
        raise CorruptDocumentError(f"Could not parse PDF {file_path!r}: {exc}") from exc
    except DependencyError as exc:
        # Raised while probing an encrypted PDF's password if no crypto
        # backend (the pypdf[crypto] extra) is installed for its
        # encryption algorithm — surface it as "can't read encrypted PDF"
        # rather than an opaque missing-dependency crash.
        raise EncryptedDocumentError(
            f"PDF {file_path!r} is encrypted and could not be probed: {exc}"
        ) from exc

    if reader.is_encrypted:
        # decrypt("") succeeds (returns a truthy PasswordType) for PDFs that
        # only set an *owner* password (restricting printing/editing but
        # leaving content readable). It returns NOT_DECRYPTED (0) when a
        # real user password is required, which is the case we must reject.
        if int(reader.decrypt("")) == 0:
            raise EncryptedDocumentError(
                f"PDF {file_path!r} is password-protected; cannot extract without a password"
            )

    try:
        pages = [
            ExtractedPage(page_number=i, text=page.extract_text() or "")
            for i, page in enumerate(reader.pages, start=1)
        ]
    except Exception as exc:
        raise CorruptDocumentError(
            f"Failed extracting text from PDF {file_path!r}: {exc}"
        ) from exc

    if not any(page.text.strip() for page in pages):
        raise EmptyDocumentError(
            f"PDF {file_path!r} yielded no extractable text "
            "(likely a scanned image with no text layer; OCR is out of scope)"
        )

    return pages


def _extract_plain_text(file_path: str) -> list[ExtractedPage]:
    with open(file_path, encoding="utf-8") as f:
        text = f.read()
    return [ExtractedPage(page_number=1, text=text)]
