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

## Current scope: Week 3 (frontend)

Per the delivery timeline: Week 1 (ingestion pipeline) and Week 2 (semantic +
keyword retrieval, RRF fusion, grounded Claude generation with citations,
`/query` endpoint) are complete. Week 3 = **frontend + retrieval debug view**
is the current week; evaluation harness work stays Week 4.

If a task seems to require working ahead of the current week, stop and flag it
rather than implementing it early — scope creep is a named project risk.

> **Branch state (read before writing any client code).** The Week 2 backend is
> **not on `main` yet**. On `main`, `POST /api/v1/documents` takes a *single*
> `file` and returns a *single* `DocumentOut`, and `/query`, `GET /documents`,
> `DELETE /documents/{id}`, `/livez`, and `/readyz` are all still
> `raise NotImplementedError` stubs. The contract documented below is the one on
> branch `worktree-week2-completion` (the superset of `worktree-query-endpoint`
> and `worktree-generation-claude-api`), which is what the frontend is being
> built against. **That branch must be merged to `main` before the frontend can
> run against a live backend.** If a response shape here disagrees with the code
> you're reading, check which branch you're on before "fixing" anything.

## Backend API contract

Base URL: `http://localhost:8000`, all routes under **`/api/v1`** (set by
`app/api/v1/router.py`; the health routes are under that same prefix, *not* at
the root). CORS allows `http://localhost:5173` (Vite's dev port) by default —
`Settings.cors_origins` in `app/core/config.py`.

**JSON is snake_case in both directions.** The backend does no alias/camelCase
conversion, so the wire types in `frontend/src/types/` mirror the Pydantic
field names exactly. Do not "fix" them to camelCase.

### `POST /api/v1/documents` — upload (FR-1)

- **Request**: `multipart/form-data`. Field name is **`files`**, repeated once
  per file (the route signature is `files: list[UploadFile]`). Sending a single
  field named `file` will 422.
- **Response**: `201` → **`DocumentOut[]`** (an array, even for one file).

```ts
interface DocumentOut {
  id: string;                 // UUID
  filename: string;
  upload_time: string;        // ISO 8601 datetime
  status: "pending" | "processing" | "ready" | "failed";
  page_count: number | null;
}
```

- Ingestion is **synchronous** — the request doesn't return until extract →
  chunk → embed → persist has finished, so `status` is already `"ready"` on a
  successful response. There is no polling/progress endpoint; the UI must show
  an indeterminate spinner and expect a slow request for large PDFs.
- **Partial batch failure is real**: files are ingested one at a time, each in
  its own transaction. If file 3 of 5 fails, files 1–2 stay committed, the
  request aborts with file 3's 4xx, and files 4–5 are never attempted — and the
  client gets *no* body listing what succeeded. After any upload error, re-fetch
  `GET /api/v1/documents` rather than trusting local state.
- `mime_type` is **not** persisted and never returned. Don't model it.

### `GET /api/v1/documents` — list (FR-11)

- **Response**: `200` → `DocumentOut[]`, ordered **newest first**
  (`upload_time DESC`). No pagination, no filtering.

### `DELETE /api/v1/documents/{document_id}` — delete (FR-11)

- **Response**: `204`, empty body. Cascades to chunks; also removes the stored
  file.
- **Idempotent**: deleting an unknown id also returns `204`, not `404`. The UI
  cannot distinguish "deleted" from "never existed".

### `POST /api/v1/query` — ask a question (FR-6, FR-9, FR-15)

- **Request**: `application/json`

```ts
interface QueryRequest {
  question: string;
  document_ids?: string[] | null;   // UUIDs; null/omitted = search all documents
  top_k?: number;                   // default 5
  mode?: "semantic" | "keyword" | "hybrid";  // default "hybrid"
}
```

Note the field is **`mode`**, not `retrieval_mode` (the *response* uses
`retrieval_mode` — they are deliberately different names).

- **Response**: `200` → `AnswerResponse`

```ts
interface AnswerResponse {
  answer: string;
  citations: CitationOut[];
  retrieved_chunks: RetrievedChunkOut[];
  retrieval_mode: RetrievalMode | null;   // null only on the FR-10 refusal, below
}

interface CitationOut {
  document: string;      // filename, NOT a document_id
  page: number | null;
  chunk_id: string;      // UUID
  snippet: string;       // chunk text truncated to 300 chars + "..."
}

interface RetrievedChunkOut {
  chunk_id: string;      // UUID
  document_id: string;   // UUID
  text: string;          // full chunk text, untruncated
  page: number | null;
  score: number;         // meaning depends on mode — see below
}
```

- `citations` and `retrieved_chunks` are **parallel arrays over the same
  chunks, in the same rank order** — one citation per retrieved chunk. They are
  not a filtered subset; the backend does not currently detect which chunks the
  model actually used.
- `CitationOut` carries the **filename** (`document`), not a `document_id`. To
  link a citation back to a document, join via `chunk_id` against
  `retrieved_chunks[].document_id`.
- `score` is **not comparable across modes, and doesn't even sort the same
  way**:
  - `semantic` → raw cosine distance from pgvector's `<=>`, **lower is better**
  - `keyword` → `ts_rank_cd`, **higher is better**
  - `hybrid` → RRF fused score (`sum(1/(60+rank))`, typically ~0.01–0.03),
    **higher is better**

  Results always arrive pre-sorted best-first, so **render them in array order
  and never re-sort by `score` yourself**. Label the score by mode, and never
  render it as a percentage or a fixed-scale bar.

**FR-10 refusal — the important edge case.** When retrieval returns *nothing*
(e.g. no documents ingested yet), the backend raises `NoContextFound`, which is
handled as a **`200`**, not an error:

```json
{ "answer": "I cannot answer this question based on the available documents.",
  "citations": [], "retrieved_chunks": [], "retrieval_mode": null }
```

So `retrieval_mode` is nullable on the wire even though the Pydantic model
types it as non-null, and the client must tolerate empty arrays on a `200`.
Separately, when retrieval *does* return chunks but none are relevant, Claude
is instructed to reply with that same sentence — so the UI should treat that
exact string as "no answer" regardless of whether citations are present.

### `GET /api/v1/livez` / `GET /api/v1/readyz`

- `livez` → `200 {"status": "ok"}`.
- `readyz` → `200 {"status": "ok"}`, or `{"status": "not_ready", "reason": "..."}`
  (still HTTP 200) if the embedding model hasn't loaded. Check the body, not
  just the status code.

### Errors

All handled errors return `{"detail": "<message>"}` (`app/main.py`). Surface
`detail` directly in the UI.

| Status | Cause | Frontend handling |
| --- | --- | --- |
| `413` | File over `max_upload_size_mb` (default 20MB) | Validate size client-side first |
| `415` | Unsupported type — only `application/pdf` and `text/plain` | Restrict the file input's `accept` |
| `422` | Extraction failed (corrupt / encrypted / no text layer) **or** FastAPI request validation | Show `detail`; wording differs between the two |
| `502` | Claude API failed after SDK retries | Offer a retry action |

Note `422` is overloaded: it covers both a malformed request body and a
genuinely unreadable document. The message text is the only way to tell.

## Missing / insufficient endpoints for the Week 3 UI

Flagging these now rather than working around them in the client. **(1) is a
blocker for the retrieval debug view; the rest are nice-to-haves.**

1. **Per-chunk retrieval provenance — blocks `RetrievalDebugView`.** The debug
   view is specified to show *semantic vs keyword contribution* per answer, but
   `RetrievedChunkOut` has no `source` field. `fusion.FusedChunk` does carry
   `semantic_rank` / `keyword_rank` / `fused_score`, and `retriever.retrieve()`
   explicitly **discards** it (unwrapping to plain `RetrievedChunk`) before
   `qa_service` ever sees it. The provenance therefore cannot reach the client
   today. Needs a small backend change: add `source: "semantic" | "keyword" |
   "both"` plus `semantic_rank` / `keyword_rank` (nullable) to
   `RetrievedChunkOut`, and stop discarding them in the hybrid path. Until then
   the debug view can only show mode + score, not the per-source breakdown.
2. **No retrieval-only endpoint** (e.g. `POST /api/v1/retrieve`). Comparing all
   three modes side-by-side currently costs three Claude calls, and every debug
   view refresh bills a generation.
3. **No `GET /api/v1/documents/{id}`** and no way to fetch a chunk or page by
   id. "View source" click-through is limited to the 300-char `snippet`; there
   is no full-page or full-document text to expand into.
4. **No document download/preview route** — citations can't link to the
   original PDF page.
5. **No streaming** — `/query` is one blocking response, so the chat UI shows a
   spinner for the full retrieve + generate round trip instead of streaming
   tokens.
6. **No upload progress / async ingest status** — see the synchronous-ingestion
   note above; a large PDF is an opaque multi-second wait.
7. **`DELETE` returns `204` for unknown ids** — the UI can't show "already
   deleted".
8. **No pagination on `GET /documents`** — fine at demo scale, will need it if
   the corpus grows.

## Frontend conventions (Week 3)

Stack is **Vite + React 18 + TypeScript (strict) + Tailwind**, already scaffolded
in `frontend/` — `package.json`, `tsconfig.json`, `tailwind.config.js`, and the
component files exist but are `TODO` stubs that `throw new Error("Not
implemented")`. Fill the stubs in; don't re-scaffold, and don't add dependencies
(routing, state libraries, component kits, fetch wrappers) without asking first.

**`vite.config.ts` is currently `defineConfig({})`** — it doesn't even register
the React plugin. It needs `plugins: [react()]` and a dev-server proxy for
`/api` → `http://localhost:8000` before anything runs.

- **Functional components only.** No class components, no `React.FC` — type
  props via an explicit `interface FooProps` and annotate the return as
  `JSX.Element`. Default-export one component per file.
- **Colocate.** A component owns its file in `src/components/`; component-local
  helpers and types live in that same file. Only genuinely shared things get
  promoted — wire types to `src/types/`, HTTP calls to `src/api/client.ts`.
- **All network access goes through `src/api/client.ts`.** No `fetch` in a
  component or hook. The client returns typed wire shapes and throws on non-2xx
  after reading `detail`.
- **`src/types/index.ts` mirrors the backend Pydantic schemas verbatim**, in
  snake_case. Its current stubs are **stale and wrong** — they invent
  `mimeType`, `uploadDate`, `pageCount`, and a `CitationOut` with
  `documentId`/`filename`. Replace them with the shapes documented above.
- **State lives in hooks**, not components: `useChat.ts` owns message history
  and calls `submitQuery`. Components render; hooks orchestrate.
- **Tailwind utilities in JSX.** No CSS modules, no styled-components; global
  CSS in `src/index.css` stays limited to the Tailwind directives.
- **Named exports for hooks and API functions; default export for components.**
- Keep the module-boundary discipline the backend uses: `components/` never
  imports from `api/` directly (go through a hook), and `api/` never imports
  from `components/`.
- Every file gets the same one-line "single responsibility" header comment the
  existing stubs use — match that style.
