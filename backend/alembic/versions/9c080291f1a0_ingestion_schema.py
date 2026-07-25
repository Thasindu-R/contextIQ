"""ingestion schema

Revision ID: 9c080291f1a0
Revises:
Create Date: 2026-07-22 15:25:41.887102

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9c080291f1a0'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute(
        """
        CREATE TABLE documents (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            filename      TEXT NOT NULL,
            upload_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
            status        TEXT NOT NULL DEFAULT 'pending',
            page_count    INTEGER
        )
        """
    )

    # content_tsv is derived from content, so it must be declared inline
    # with the CREATE TABLE (a generated column cannot be added via a
    # separate ALTER TABLE ... ADD COLUMN in the same way as a plain column
    # without a rewrite, and defining it here keeps it colocated with the
    # column it depends on).
    op.execute(
        """
        CREATE TABLE chunks (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            chunk_index   INTEGER NOT NULL,
            content       TEXT NOT NULL,
            page_number   INTEGER,
            embedding     vector(384),
            content_tsv   tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
        )
        """
    )

    op.execute("CREATE INDEX ix_chunks_content_tsv ON chunks USING GIN (content_tsv)")

    # HNSW, not ivfflat: ivfflat's k-means centroids are built from
    # whatever rows exist at index-creation time, so on an empty/near-empty
    # table (Week 1, no bulk backfill yet) it produces poor centroids that
    # degrade recall until a REINDEX after the table is populated. HNSW has
    # no such training step.
    op.execute(
        "CREATE INDEX ix_chunks_embedding_hnsw ON chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_chunks_content_tsv")
    op.execute("DROP TABLE IF EXISTS chunks")
    op.execute("DROP TABLE IF EXISTS documents")
    # Deliberately not dropping the vector extension: it is a
    # cluster/schema-wide resource that other migrations or schemas may
    # depend on, so downgrades shouldn't strip it out from under them.
