"""Prompt construction.

Single responsibility (NFR-5): build a strict context-only prompt
from retrieved chunks (NFR-9), instructing the model to state it
cannot answer when no context is available (FR-10). No API-calling
logic here.
"""
from __future__ import annotations

from app.models.chunk import Chunk

NO_CONTEXT_INSTRUCTION = (
    "TODO: instruction telling the model to state it cannot answer "
    "when no relevant context is provided (FR-10)."
)


def build_prompt(question: str, chunks: list[Chunk]) -> str:
    """Build a context-grounded prompt restricting the model to the
    supplied chunks only (NFR-9).

    TODO: format chunks with source/page metadata, embed
    NO_CONTEXT_INSTRUCTION handling, embed the question.
    """
    raise NotImplementedError
