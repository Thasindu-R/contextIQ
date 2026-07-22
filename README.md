# ContextIQ
Hybrid-search RAG system combining pgvector semantic search + PostgreSQL full-text search via Reciprocal Rank Fusion, with source-grounded citations and comparative retrieval evaluation. FastAPI · React/TS · Claude API

> **Status:** scaffolding only. This repo currently contains stub files (typed signatures, `TODO`/`NotImplementedError` bodies) — no business logic is implemented yet.

## Architecture

```
Client (React/TS)
   -> FastAPI (api/v1) -> services -> {repositories, retrieval, generation, ingestion}
                                            |
                                    PostgreSQL + pgvector
                                    (semantic search + tsvector keyword search)
                                            |
                                  Reciprocal Rank Fusion (hybrid mode)
                                            |
                                       Claude API (generation)
```

- **Ingestion**: upload -> extract (PDF/text, page-aware) -> chunk (overlapping) -> embed (sentence-transformers) -> dual-store (pgvector + tsvector), run as a background task.
- **Retrieval**: three explicit modes — semantic-only, keyword-only, hybrid (parallel search fused via RRF, k=60 default) — selected per query, shared by the API and the evaluation harness.
- **Generation**: strict context-only prompting against Claude; explicitly answers "cannot answer" when no relevant context is retrieved.

## Setup

```bash
cp .env.example .env            # fill in CLAUDE_API_KEY
cp backend/.env.example backend/.env
make up                         # docker compose up --build
```

- Backend: FastAPI on `:8000` (`/api/v1`, `/livez`, `/readyz`)
- Frontend: React/Vite SPA served via nginx on `:80`
- DB: Postgres + pgvector, schema in `backend/db/init.sql`

Run tests: `make test` · Run the retrieval-mode evaluation: `make eval` · Lint: `make lint`

## Retrieval-mode accuracy comparison

Populated by `backend/evaluation/run_eval.py` against `backend/evaluation/eval_set.json` (15-20 hand-authored Q&A pairs) once ingestion, retrieval, and generation are implemented.

| Mode          | Retrieval accuracy (top-k hit) | Answer correctness |
|---------------|:-------------------------------:|:-------------------:|
| Semantic-only | TBD                              | TBD                  |
| Keyword-only  | TBD                              | TBD                  |
| Hybrid (RRF)  | TBD                              | TBD                  |
