# ContextIQ
Hybrid-search RAG system combining pgvector semantic search + PostgreSQL full-text search via Reciprocal Rank Fusion, with source-grounded citations and comparative retrieval evaluation. FastAPI · React/TS · Claude API

> **Status:** ingestion, hybrid retrieval, streaming generation and the web UI are implemented and tested end to end. The retrieval-mode evaluation harness (`backend/evaluation/`) is the remaining stub.

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
make up                         # docker compose up --build
```

Compose reads the repo-root `.env` for every service, so that one file is the
only configuration step. `CLAUDE_API_KEY` is the only value with no usable
default — compose refuses to start without it rather than letting the backend
crash-loop.

- Frontend: React/Vite SPA served by nginx on **`:8080`** — start here
- Backend: FastAPI on `:8000`, all routes under `/api/v1` (health probes
  included: `/api/v1/livez`, `/api/v1/readyz`)
- DB: Postgres + pgvector. `backend/db/init.sql` enables the extension; the
  tables come from alembic, which the backend runs at startup.

First boot is slow: the backend downloads the embedding model (~90MB, cached
in a volume afterwards) and applies migrations before it reports healthy, and
the frontend waits for that.

Run tests: `make test` · Run the retrieval-mode evaluation: `make eval` · Lint: `make lint`

## Frontend

Vite + React 18 + TypeScript (strict) + Tailwind, in `frontend/`. Two screens
behind a shared shell: **Ask** (`/ask`, the default) and **Library**
(`/documents`).

### Running it in dev

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8000`, so run the backend
separately (`cd backend && uvicorn app.main:app --reload`) with a
Postgres+pgvector database on `DATABASE_URL` and `alembic upgrade head`
applied. Because the proxy makes requests same-origin, `VITE_API_BASE_URL`
stays empty in dev and CORS never enters into it.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR on `:5173`, `/api` proxied to `:8000` |
| `npm test` | Vitest + React Testing Library (API client mocked; no DB or API key needed) |
| `npm run lint` / `format` / `typecheck` | ESLint, Prettier, `tsc --noEmit` |
| `npm run build` | Production bundle into `dist/` |

### Running the full stack

```bash
cp .env.example .env            # fill in CLAUDE_API_KEY
docker compose up --build       # or: make up
```

Then open **http://localhost:8080**. Compose starts Postgres, waits for it to
be healthy, starts the backend (which applies migrations and loads the
embedding model), waits for *that* to report ready, and only then starts the
frontend — so the first page load can already reach the API.

Budget time for the first `--build`: the backend image installs
sentence-transformers, which pulls torch (~2GB), so that layer dominates and
wants a stable connection. It is cached afterwards, and the frontend image is
small (~76MB) because only the built `dist/` and nginx survive into the final
stage.

The frontend image is multi-stage: Node builds the Vite bundle, then
`nginx:alpine` serves the static output. nginx also reverse-proxies `/api` to
the `backend` service, which is what keeps the browser talking to a single
origin.

Two things in `frontend/nginx.conf` are load-bearing rather than decorative:

- **`proxy_buffering off`** — `POST /api/v1/query` is a Server-Sent Events
  stream. With nginx's default buffering the whole answer accumulates and
  arrives as one blob: the app still works, but silently stops streaming.
- **`client_max_body_size 25m`** — nginx caps request bodies at 1MB by
  default, which would reject a perfectly legal 20MB PDF upload with an HTML
  error the client can't parse, before FastAPI ever sees it.

### Environment variables

Frontend config is read in exactly one module (`src/config.ts`); nothing else
touches `import.meta.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | *(empty)* | Base URL for API calls. Empty = same-origin, which is what the dev proxy and the nginx `/api` proxy both provide. Set it only when the API lives on another origin, and add that origin to the backend's `Settings.cors_origins`. |
| `FRONTEND_PORT` | `8080` | Host port for the frontend container. Not `80`, which needs root. |
| `BACKEND_PORT` | `8000` | Host port for the API. |
| `POSTGRES_PORT` | `5433` | Host port for the database. Deliberately not `5432` — a locally installed Postgres usually holds that already, and compose fails with "port is already allocated" rather than picking another. Only affects `psql` from the host; the backend reaches the database as `db:5432` on the compose network. |

`VITE_API_BASE_URL` is **inlined at build time** — Vite substitutes it into the
bundle, so it cannot be changed by restarting the container. Compose passes it
as a build arg; changing it means `docker compose build frontend`.

The backend's variables (`CLAUDE_API_KEY`, `DATABASE_URL`, `CHUNK_SIZE`,
`TOP_K`, `RRF_K`, `MAX_UPLOAD_SIZE_MB`, …) are documented in `.env.example` and
consumed only by `backend/app/core/config.py`.

### The screens

**Ask (`/ask`)** — the product. A conversation thread: your questions in
indigo bubbles on the right, answers on a light card to the left, rendered
token by token as they stream in (a three-dot typing indicator holds the space
until the first token lands). Inline `[1]`/`[2]` markers in the answer become
small amber **citation chips**; hovering one highlights the matching source,
clicking pins it and scrolls it into view — and the reverse works too. Each
finished answer carries Copy and Regenerate; a failed one shows the backend's
message inline with a Retry. Above the composer, a document filter scopes the
question to selected documents.

**Sources panel** — docked to the right of the chat (stacked underneath it on
a narrow window, and collapsible). Header names the retrieval mode that
produced the results, e.g. *"Hybrid search, RRF fused · 4 passages"*, plus how
to read the score for that mode. Each source card shows its citation number,
document and page, the passage text (truncated with a *Show more*), the raw
score with a ↑/↓ direction hint, and a colour-coded tag for which retriever
surfaced it — **keyword** emerald, **semantic** blue, **both** amber — with
the per-leg ranks beside it (`semantic #1 · keyword #1`). A chunk tagged
*both* placed in both rankings, which is precisely what RRF rewards; that is
the hybrid-search story the panel exists to tell. A small legend explains the
tags.

**Library (`/documents`)** — a drag-and-drop upload zone (PDF and plain text,
20MB cap, both enforced client-side before the request), then the document
list: filename, upload time, page count, a status pill (**Ready** emerald,
**Failed** red, *Pending*/*Processing* while ingesting) and a delete button.
Ingestion is synchronous, so uploads show an indeterminate "Ingesting…"
spinner rather than a progress bar.

Both screens share the sidebar shell (which collapses to a top bar under
`md`), a light/dark theme toggle that persists and respects
`prefers-color-scheme`, and toast notifications for ambient failures.

## Retrieval-mode accuracy comparison

Populated by `backend/evaluation/run_eval.py` against `backend/evaluation/eval_set.json` (15-20 hand-authored Q&A pairs) once ingestion, retrieval, and generation are implemented.

| Mode          | Retrieval accuracy (top-k hit) | Answer correctness |
|---------------|:-------------------------------:|:-------------------:|
| Semantic-only | TBD                              | TBD                  |
| Keyword-only  | TBD                              | TBD                  |
| Hybrid (RRF)  | TBD                              | TBD                  |
