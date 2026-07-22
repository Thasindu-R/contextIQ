"""Application settings.

Single responsibility (NFR-5): centralize all environment-driven
configuration (DB connection, Claude API key, chunking parameters,
retrieval parameters, embedding model name) behind a single typed
Settings object so no other module reads os.environ directly (NFR-7).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Typed application configuration loaded from environment / .env.

    TODO: declare fields for:
      - database_url: str
      - claude_api_key: str
      - embedding_model: str
      - chunk_size: int
      - chunk_overlap: int
      - top_k: int
      - rrf_k: int
    """

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance for dependency injection.

    TODO: return Settings()
    """
    raise NotImplementedError
