"""Tests for the generation layer.

Single responsibility (NFR-5): verify prompt_builder produces
context-only prompts (NFR-9), correctly handles the empty-context
case (FR-10), and claude_client handles errors per NFR-3.
"""
from __future__ import annotations


def test_build_prompt_includes_no_context_instruction_when_empty():
    """FR-10: empty chunk list should yield a prompt that instructs
    the model to say it cannot answer.

    TODO: implement once generation.prompt_builder.build_prompt is
    implemented.
    """
    raise NotImplementedError


def test_claude_client_raises_upstream_error_on_failure(mock_claude_client):
    """NFR-3: persistent API failures should surface as UpstreamAPIError.

    TODO: implement once generation.claude_client.generate is
    implemented.
    """
    raise NotImplementedError
