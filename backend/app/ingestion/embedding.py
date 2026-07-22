"""Embedding generation.

Single responsibility (NFR-5): generate dense vector embeddings for
chunk text using a sentence-transformers model (FR-4). No chunking or
storage logic here.
"""
from __future__ import annotations


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts (FR-4).

    TODO: load the configured sentence-transformers model
    (Settings.embedding_model, default all-MiniLM-L6-v2) and encode
    texts in batch, returning one 384-dim vector per input.
    """
    raise NotImplementedError
