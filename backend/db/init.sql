-- init.sql
-- Single responsibility: database bootstrap DDL for ContextIQ.
--
-- This file runs once, from Postgres's docker-entrypoint-initdb.d, on an
-- empty data volume. Its only job is to make the `vector` type exist
-- before anything tries to use it: alembic's first migration also issues
-- CREATE EXTENSION, but the extension has to be installable by the
-- superuser the entrypoint runs as, and doing it here keeps that
-- requirement out of the application's migration path.
--
-- The tables are deliberately NOT defined here. `alembic upgrade head`
-- owns the schema (see alembic/versions/9c080291f1a0_ingestion_schema.py),
-- and the backend container runs it at startup. Two sources of truth for
-- the same tables is how they drift -- an earlier revision of this file
-- carried a commented-out skeleton that had already diverged from the
-- migration (documents.upload_date vs upload_time, chunks.text/page/
-- text_search vs content/page_number/content_tsv), so uncommenting it
-- would have produced a schema the ORM could not read.

CREATE EXTENSION IF NOT EXISTS vector;
