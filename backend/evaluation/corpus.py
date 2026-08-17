"""Evaluation corpus and ground truth.

Single responsibility (NFR-5): turn the two files that define the
evaluation -- eval_set.json and the documents under
evaluation/documents/ -- into an ingested corpus plus the chunk-id
ground truth run_eval.py scores against. No retrieval, no generation,
and no metric computation here.

Ingestion goes through services.document_service, the same path the
upload API uses, so the corpus is chunked and embedded exactly as a
user-uploaded document would be. An evaluation that ingested its
fixtures by a shortcut would be measuring a pipeline nobody runs.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.ingestion.embedding import EmbeddingService
from app.ingestion.extraction import PDF_MIME_TYPE, TEXT_MIME_TYPE
from app.repositories import chunk_repo
from app.services import document_service

EVALUATION_DIR = Path(__file__).parent
EVAL_SET_PATH = EVALUATION_DIR / "eval_set.json"
DOCUMENTS_DIR = EVALUATION_DIR / "documents"

_MIME_TYPES = {".txt": TEXT_MIME_TYPE, ".pdf": PDF_MIME_TYPE}


class EvalSetError(Exception):
    """The eval set and the corpus disagree.

    Raised loudly rather than skipped: a locator that resolves to no
    chunk means a question is being scored against ground truth that
    does not exist, which silently deflates every mode's accuracy by
    the same amount and looks like a retrieval regression.
    """


@dataclass
class EvalPair:
    """One hand-authored question and everything needed to score it."""

    id: str
    kind: str
    question: str
    document: str | None
    locators: list[str]
    expected_answer: str
    required_facts: list[str]
    # Filled in by resolve_ground_truth once the corpus has been
    # ingested and the chunk ids for this run exist.
    expected_chunk_ids: list[str] = field(default_factory=list)

    @property
    def is_answerable(self) -> bool:
        """False for the FR-10 pairs, which have no supporting chunk.

        Retrieval metrics are meaningless for those (there is nothing
        correct to retrieve) and they are scored on refusal instead,
        so run_eval splits its aggregates on this.
        """
        return self.document is not None


def load_eval_set(path: Path = EVAL_SET_PATH) -> list[EvalPair]:
    """Read eval_set.json into EvalPairs, validating shape (FR-12)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    pairs = [
        EvalPair(
            id=entry["id"],
            kind=entry["kind"],
            question=entry["question"],
            document=entry["document"],
            locators=list(entry["locators"]),
            expected_answer=entry["expected_answer"],
            required_facts=list(entry["required_facts"]),
        )
        for entry in raw["qa_pairs"]
    ]

    if not pairs:
        raise EvalSetError(f"{path} contains no Q&A pairs")

    duplicates = {pair.id for pair in pairs if [p.id for p in pairs].count(pair.id) > 1}
    if duplicates:
        raise EvalSetError(f"Duplicate eval pair ids: {sorted(duplicates)}")

    for pair in pairs:
        if pair.is_answerable and not pair.locators:
            raise EvalSetError(
                f"Pair {pair.id} names a document but no locators, so it has no ground truth. "
                "Give it locators, or set document to null to score it as unanswerable."
            )
        if not pair.is_answerable and pair.locators:
            raise EvalSetError(f"Pair {pair.id} has locators but no document")

    return pairs


def corpus_files(documents_dir: Path = DOCUMENTS_DIR) -> list[Path]:
    """List the corpus files, sorted for a reproducible ingest order."""
    files = sorted(p for p in documents_dir.iterdir() if p.suffix in _MIME_TYPES)
    if not files:
        raise EvalSetError(
            f"No .txt or .pdf documents in {documents_dir}. The evaluation "
            "needs a fixed corpus to retrieve from."
        )
    return files


async def ingest_corpus(
    session: AsyncSession,
    embedding_service: EmbeddingService,
    settings: Settings,
    documents_dir: Path = DOCUMENTS_DIR,
    reingest: bool = False,
) -> tuple[dict[str, uuid.UUID], bool]:
    """Ingest the corpus, returning ({filename: document_id}, ingested).

    An already-ingested corpus is reused by default, and that is a
    reproducibility decision rather than a speed one. Chunk ids are
    generated per ingest, and the keyword leg breaks ts_rank_cd ties on
    them, so re-ingesting reshuffles ties and moves the reported
    numbers by a question or two between otherwise identical runs. Pass
    reingest=True after editing the corpus -- or trust
    resolve_ground_truth, which fails loudly if the stored chunks no
    longer contain a locator.

    When it does ingest, it first deletes any document stored under a
    corpus filename, so running twice cannot double the corpus and
    halve every recall figure. Deletion is scoped to those filenames,
    so pointing DATABASE_URL at a database holding other documents
    leaves them untouched -- and retrieval is scoped to the returned
    ids, so they do not pollute the results either. Anything already
    stored under a corpus filename *is* replaced, which is the one case
    to be aware of before running this against a database you care
    about.
    """
    files = corpus_files(documents_dir)
    filenames = {path.name for path in files}

    # The listing runs inside an explicit transaction so it closes when
    # the block exits. A bare SELECT would leave SQLAlchemy's implicit
    # transaction open, and the very next `async with session.begin()`
    # -- inside delete_document and upload_document -- raises
    # "A transaction is already begun on this Session". The API never
    # hits this because each request gets its own session.
    async with session.begin():
        existing = await document_service.list_documents(session)

    stored = {document.filename: document.id for document in existing}
    if not reingest and filenames <= stored.keys():
        return {name: stored[name] for name in filenames}, False

    for document in existing:
        if document.filename in filenames:
            await document_service.delete_document(session, settings, document.id)

    document_ids: dict[str, uuid.UUID] = {}
    for path in files:
        ingested = await document_service.upload_document(
            session,
            embedding_service,
            settings,
            file_bytes=path.read_bytes(),
            filename=path.name,
            mime_type=_MIME_TYPES[path.suffix],
        )
        document_ids[path.name] = ingested.id

    return document_ids, True


async def resolve_ground_truth(
    session: AsyncSession,
    pairs: list[EvalPair],
    document_ids: dict[str, uuid.UUID],
) -> None:
    """Attach this run's expected chunk ids to each answerable pair.

    A locator is a verbatim substring of the source document; every
    chunk containing it is relevant ground truth. Chunks overlap by
    `chunk_overlap` characters, so a locator near a boundary
    legitimately resolves to two chunks -- both are counted, which is
    why recall_at_k is reported alongside the hit rate.

    Raises EvalSetError if any locator resolves to nothing, which
    almost always means the eval set was edited without re-checking it
    against the corpus, or the locator straddles a chunk boundary.
    """
    chunks_by_document = {
        filename: await chunk_repo.list_by_document(session, document_id)
        for filename, document_id in document_ids.items()
    }

    unresolved: list[str] = []
    for pair in pairs:
        if not pair.is_answerable:
            continue

        chunks = chunks_by_document.get(pair.document)
        if chunks is None:
            raise EvalSetError(
                f"Pair {pair.id} names document {pair.document!r}, which is not in the corpus"
            )

        matched: list[str] = []
        for locator in pair.locators:
            hits = [str(chunk.id) for chunk in chunks if locator in chunk.content]
            if not hits:
                unresolved.append(f"{pair.id}: {locator!r} in {pair.document}")
            matched.extend(hits)

        pair.expected_chunk_ids = sorted(set(matched))

    if unresolved:
        raise EvalSetError(
            "Locators that matched no chunk (fix eval_set.json or the corpus):\n  "
            + "\n  ".join(unresolved)
        )
