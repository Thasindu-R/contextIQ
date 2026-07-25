"""Claude API client wrapper.

Single responsibility (NFR-5): wrap calls to the Claude API with
retry/error handling (FR-8, NFR-3). No prompt construction or
retrieval logic here.
"""
from __future__ import annotations

from functools import lru_cache

import anthropic

from app.core.config import get_settings
from app.core.exceptions import UpstreamAPIError

MAX_TOKENS = 1024


@lru_cache
def _get_client() -> anthropic.AsyncAnthropic:
    """Construct (and cache) the async Anthropic client.

    Cached the same way core.database.get_engine is: built once from
    Settings (NFR-7) and reused, never per-call.
    """
    return anthropic.AsyncAnthropic(api_key=get_settings().claude_api_key)


async def generate(prompt: str) -> str:
    """Call the Claude API with the given prompt and return the
    generated answer text (FR-8).

    The Anthropic SDK already retries connection errors, 429, and 5xx
    with exponential backoff (default max_retries=2) -- persistent
    failures past that surface here as UpstreamAPIError (NFR-3) rather
    than a raw SDK exception, so callers (qa_service) never need to
    know this is backed by Anthropic specifically.
    """
    client = _get_client()
    try:
        response = await client.messages.create(
            model=get_settings().claude_model,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise UpstreamAPIError(f"Claude API call failed: {exc}") from exc

    if response.stop_reason == "refusal":
        raise UpstreamAPIError("Claude declined to generate a response")

    return next((block.text for block in response.content if block.type == "text"), "")
