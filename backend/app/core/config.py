"""Application settings.

Single responsibility (NFR-5): centralize all environment-driven
configuration (DB connection, Claude API key, chunking parameters,
retrieval parameters, embedding model name) behind a single typed
Settings object so no other module reads os.environ directly (NFR-7).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed application configuration loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env")

    database_url: str
    claude_api_key: str
    embedding_model: str = "all-MiniLM-L6-v2"
    chunk_size: int = 500
    chunk_overlap: int = 50
    top_k: int = 5
    rrf_k: int = 60
    max_upload_size_mb: int = 20
    storage_dir: str = "storage"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance for dependency injection."""
    return Settings()
