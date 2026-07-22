"""Embedding generation.

Single responsibility (NFR-5): generate dense vector embeddings for
chunk text using a sentence-transformers model (FR-4), loaded once at
app startup (see app.main's lifespan) rather than per call. No
chunking or storage logic here.
"""
from __future__ import annotations

import asyncio

from sentence_transformers import SentenceTransformer

EMBEDDING_DIM = 384  # matches all-MiniLM-L6-v2


class EmbeddingService:
    """Wraps a single, already-loaded sentence-transformers model.

    Construct exactly once via `load_model` (done by app.main's
    lifespan at startup) and share the instance for the app's
    lifetime — the model itself is what's expensive to load, not
    encoding, but re-loading it per call would still be wasteful and
    would defeat batching.
    """

    def __init__(self, model: SentenceTransformer) -> None:
        self._model = model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Batch-encode texts into L2-normalized embeddings (FR-4).

        normalize_embeddings=True so the stored vectors' cosine
        distance matches what the pgvector index computes (FR-5/FR-7).

        This is blocking CPU-bound work. It's fine to call directly
        from sync code (scripts, the evaluation harness); from an
        async def handler, call `embed_texts_async` instead so it
        doesn't stall the event loop.
        """
        if not texts:
            return []
        vectors = self._model.encode(
            texts,
            batch_size=32,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vectors.tolist()

    async def embed_texts_async(self, texts: list[str]) -> list[list[float]]:
        """Async-safe wrapper around `embed_texts` (FR-4).

        encode() is blocking CPU work; calling it inline inside an
        async def handler would stall the event loop for every other
        in-flight request. Offload it to a worker thread instead.
        """
        return await asyncio.to_thread(self.embed_texts, texts)


def load_model(model_name: str) -> EmbeddingService:
    """Load the sentence-transformers model (FR-4).

    Intended to be called exactly once, from app.main's lifespan at
    startup — never per request and never per call.
    """
    return EmbeddingService(SentenceTransformer(model_name))
