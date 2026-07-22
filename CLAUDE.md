# ContextIQ

Hybrid-search RAG document Q&A platform: pgvector semantic search + PostgreSQL
full-text search, fused via Reciprocal Rank Fusion (RRF), with source-grounded
citations via the Claude API. See `~/Downloads/contextIQ_proposal.pdf` for the
full proposal (objectives, FR/NFR tables, architecture, timeline).

## Stack

- **Backend API**: FastAPI (Python 3.11+), async
- **Embeddings**: sentence-transformers (`all-MiniLM-L6-v2`), local, no per-call cost
- **Vector store**: PostgreSQL + pgvector
- **Keyword search**: PostgreSQL native full-text search (`tsvector`/`tsquery`)
- **Result fusion**: Reciprocal Rank Fusion (RRF, k=60 default), implemented in Python
- **Generation**: Claude API, strict context-only prompting
- **Frontend**: React + TypeScript + Tailwind CSS
- **Containerization**: Docker + Docker Compose
- **Deployment**: Railway / Render / Fly.io

## Directory layout

```
backend/
  app/
    api/v1/          FastAPI routes (documents, query, health) + router aggregation
    core/            settings, db engine, exceptions, logging — no business logic
    ingestion/       extraction, chunking, embedding, pipeline orchestrator
    retrieval/       semantic search, keyword search, RRF fusion, mode dispatch
    generation/      Claude client wrapper, prompt construction
    models/          SQLAlchemy models (document, chunk)
    repositories/    DB access (document_repo, chunk_repo)
    schemas/         Pydantic request/response schemas
    services/        use-case orchestration, calling into the layers above
  db/init.sql        schema (pgvector + tsvector columns)
  evaluation/        eval_set.json + run_eval.py + metrics.py (semantic vs keyword vs hybrid)
  tests/
frontend/
  src/
    api/client.ts
    components/      ChatWindow, FileUpload, CitationBadge, RetrievalDebugView, ...
    hooks/useChat.ts
docker-compose.yml
Makefile
```

## Module boundaries (NFR-5)

Ingestion / retrieval / generation / API must stay separate. Concretely:

- **`ingestion/`** (extraction, chunking, embedding, `pipeline.py`): owns turning an
  uploaded file into stored chunks + embeddings + tsvectors. Never calls retrieval,
  generation, or route code.
- **`retrieval/`** (`semantic.py`, `keyword.py`, `fusion.py`, `retriever.py`): owns
  turning a query into ranked chunks. `retriever.py` is the single dispatch point
  for retrieval mode (FR-15) and is shared by the API and the evaluation harness.
  Never does prompt construction or calls the Claude API.
- **`generation/`** (`claude_client.py`, `prompt_builder.py`): owns building the
  grounded prompt and calling Claude. Never queries the database or performs
  retrieval itself — it only accepts chunks that were already retrieved.
- **`api/`**: routes + request/response wiring only. No extraction, retrieval, or
  generation logic lives here — routes call into `services/`, which orchestrates
  `ingestion/`, `retrieval/`, `generation/`, and `repositories/`.

Rule of thumb: a file in one of these four layers should never import
implementation internals from another layer — only the narrow function
signatures each module exposes (e.g. `retriever.retrieve(...)`,
`generation.generate(...)`).

## Week 1 scope only

Per the delivery timeline, Week 1 = **ingestion pipeline only**. Build and verify
(via direct API calls, no UI) the following, and nothing beyond it:

- Document upload endpoint (`api/v1/documents.py`)
- Text extraction (PDF + plain text, page-aware) — `ingestion/extraction.py`
- Chunking (overlapping, fixed-size) — `ingestion/chunking.py`
- Embedding generation (sentence-transformers) — `ingestion/embedding.py`
- pgvector storage + a populated `tsvector` column per chunk — `ingestion/pipeline.py`,
  `repositories/chunk_repo.py`, `db/init.sql`

**Do NOT build yet, even as stubs-made-real:**

- No retrieval logic (`retrieval/semantic.py`, `retrieval/keyword.py`,
  `retrieval/retriever.py` stay `NotImplementedError`) — that's Week 2.
- No RRF fusion (`retrieval/fusion.py`) — Week 2.
- No Claude API integration (`generation/claude_client.py`,
  `generation/prompt_builder.py`) — Week 2.
- No frontend work (`frontend/` untouched) — Week 3.
- No evaluation harness work (`evaluation/`) — Week 4.

If a task seems to require touching one of the above ahead of schedule, stop and
flag it rather than implementing it early — scope creep is a named project risk.
