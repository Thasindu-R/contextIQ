"""Claude API client wrapper.

Single responsibility (NFR-5): wrap calls to the Claude API with
retry/error handling (FR-8, NFR-3). No prompt construction or
retrieval logic here.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
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


async def stream(prompt: str) -> AsyncIterator[str]:
    """Yield the answer's text deltas as Claude produces them (FR-8).

    The single entry point to Claude: /query streams, so there is no
    non-streaming counterpart to keep in sync. The SDK already retries
    connection errors, 429, and 5xx with exponential backoff (default
    max_retries=2); persistent failures past that surface as
    UpstreamAPIError (NFR-3) rather than a raw SDK exception, so
    callers never need to know this is backed by Anthropic
    specifically.

    Two consequences of streaming worth stating explicitly:

    - The refusal check can only run *after* the last delta, since
      stop_reason isn't known until the message completes. So a refused
      generation may have already yielded text. Callers must treat the
      raised error as superseding anything they've emitted, not as an
      addendum to it.
    - Abandoning this generator (the client disconnected, the caller
      broke out of its loop) closes the `async with` on the way out,
      which tears down the HTTP request to Anthropic and stops
      generation. That is the entire cancellation mechanism -- there is
      nothing to cancel explicitly.
    """
    client = _get_client()
    try:
        async with client.messages.stream(
            model=get_settings().claude_model,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        ) as message_stream:
            async for text in message_stream.text_stream:
                yield text
            final_message = await message_stream.get_final_message()
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise UpstreamAPIError(f"Claude API call failed: {exc}") from exc

    if final_message.stop_reason == "refusal":
        raise UpstreamAPIError("Claude declined to generate a response")
