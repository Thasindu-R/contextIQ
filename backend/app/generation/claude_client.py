"""Claude API client wrapper.

Single responsibility (NFR-5): wrap calls to the Claude API with
retry/error handling (FR-8, NFR-3). No prompt construction or
retrieval logic here.
"""
from __future__ import annotations


async def generate(prompt: str) -> str:
    """Call the Claude API with the given prompt and return the
    generated answer text (FR-8).

    TODO: instantiate the Anthropic client with Settings.claude_api_key,
    call messages.create with retry/backoff, raise UpstreamAPIError on
    persistent failure (NFR-3).
    """
    raise NotImplementedError
