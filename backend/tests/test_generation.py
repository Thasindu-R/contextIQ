"""Tests for the generation layer.

Single responsibility (NFR-5): verify prompt_builder produces
context-only prompts (NFR-9), correctly handles the empty-context
case (FR-10), and claude_client handles errors per NFR-3.
"""
from __future__ import annotations

import uuid

import anthropic
import pytest

from app.core.exceptions import UpstreamAPIError
from app.generation import claude_client
from app.generation.prompt_builder import NO_CONTEXT_INSTRUCTION, build_prompt
from app.retrieval.types import RetrievedChunk


def _dummy_chunk(text: str, filename: str = "doc.txt", page: int | None = 1) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        filename=filename,
        page_number=page,
        text=text,
        score=0.1,
    )


def test_build_prompt_includes_no_context_instruction_when_empty():
    """FR-10: empty chunk list should yield a prompt that instructs
    the model to say it cannot answer."""
    prompt = build_prompt("What is the capital of France?", [])

    assert NO_CONTEXT_INSTRUCTION in prompt
    assert "What is the capital of France?" in prompt


def test_build_prompt_includes_chunk_content_and_source_labels():
    """NFR-9: non-empty chunk list should inject each chunk's text and
    its source (filename + page) into the prompt."""
    chunk = _dummy_chunk("Paris is the capital of France.", filename="geo.txt", page=3)

    prompt = build_prompt("What is the capital of France?", [chunk])

    assert NO_CONTEXT_INSTRUCTION in prompt
    assert "Paris is the capital of France." in prompt
    assert "geo.txt" in prompt
    assert "3" in prompt


async def test_claude_client_raises_upstream_error_on_failure(monkeypatch):
    """NFR-3: persistent API failures should surface as UpstreamAPIError."""

    def httpx_request():
        import httpx

        return httpx.Request("POST", "https://api.anthropic.com/v1/messages")

    class _FakeMessages:
        def stream(self, **kwargs):
            raise anthropic.APIConnectionError(request=httpx_request())

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.messages = _FakeMessages()

    monkeypatch.setattr(claude_client, "_get_client", lambda: _FakeClient())

    with pytest.raises(UpstreamAPIError):
        async for _ in claude_client.stream("some prompt"):
            pass
