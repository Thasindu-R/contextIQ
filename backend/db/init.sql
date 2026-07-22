-- init.sql
-- Single responsibility: database bootstrap DDL for ContextIQ.
-- Enables pgvector, and defines (commented) schema skeletons for
-- documents/chunks plus the indexes needed for hybrid search
-- (GIN on tsvector for FR-13, ivfflat on embedding for FR-7).

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------
-- documents
-- -----------------------------------------------------------------
-- CREATE TABLE documents (
--     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     filename      TEXT NOT NULL,
--     mime_type     TEXT NOT NULL,
--     upload_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
--     status        TEXT NOT NULL DEFAULT 'pending',
--     page_count    INTEGER
-- );

-- -----------------------------------------------------------------
-- chunks
-- -----------------------------------------------------------------
-- CREATE TABLE chunks (
--     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
--     text          TEXT NOT NULL,
--     page          INTEGER,
--     chunk_index   INTEGER NOT NULL,
--     embedding     vector(384),      -- matches all-MiniLM-L6-v2
--     text_search   tsvector
-- );

-- -----------------------------------------------------------------
-- keep text_search in sync with `text` (FR-13)
-- -----------------------------------------------------------------
-- CREATE FUNCTION chunks_text_search_trigger() RETURNS trigger AS $$
-- BEGIN
--     NEW.text_search := to_tsvector('english', NEW.text);
--     RETURN NEW;
-- END
-- $$ LANGUAGE plpgsql;
--
-- CREATE TRIGGER trg_chunks_text_search
--     BEFORE INSERT OR UPDATE ON chunks
--     FOR EACH ROW EXECUTE FUNCTION chunks_text_search_trigger();

-- -----------------------------------------------------------------
-- indexes
-- -----------------------------------------------------------------
-- CREATE INDEX idx_chunks_text_search ON chunks USING GIN (text_search);
-- CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
