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
- **Frontend**: Vite + React 18 + TypeScript (strict) + Tailwind CSS
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
    components/      ChatWindow, UploadZone, DocumentCard, StatusPill, Toast,
                     DocumentList, CitationBadge, RetrievalDebugView, ...
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
`/query` endpoint) are complete — verified by an end-to-end integration test
(`tests/test_query_api.py`) that ingests a document over the real API and
asks a question against it, confirming a grounded answer with correct
citations, plus a graceful "cannot answer" refusal (never a 500) for both an
empty-retrieval query and an off-topic question answered by Claude itself.
Week 3 = **frontend + retrieval debug view** is the current week; evaluation
harness work stays Week 4.

If a task seems to require working ahead of the current week, stop and flag it
rather than implementing it early — scope creep is a named project risk.

> **Branch state.** The Week 2 backend **is now on `main`** — merged from
> `worktree-week2-completion` via PR #2 (merge commit `1e6df9a`), which was a
> clean fast-forward with all 44 backend tests passing against a real
> Postgres+pgvector. The contract documented below is what's on `main`, so the
> frontend can be built against it directly.
>
> Two older branches, `worktree-query-endpoint` and
> `worktree-generation-claude-api`, are **superseded** — their work is included
> in what was merged. Don't build against them.

> **Running the checks locally.** CI (`.github/workflows/ci.yml`) really runs
> `ruff check` plus the full pytest suite against a `pgvector/pgvector:pg16`
> service container, and lint + format-check + typecheck + build for the
> frontend. To reproduce the backend job locally, point `DATABASE_URL` at a
> Postgres+pgvector database with `alembic upgrade head` applied — but note the
> fixtures `TRUNCATE documents, chunks`, so **use a throwaway database, never
> your dev one** (a `contextiq_test` database already exists locally for this).

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

- **Response**: `200` → **`text/event-stream`**. This endpoint streams; there
  is no JSON body and no non-streaming variant.

Each event is a single `data: {json}` line terminated by a blank line. Frames
arrive as: zero or more `token`, then **exactly one** terminal frame — `done`
on success, `error` if generation failed.

```ts
type QueryStreamFrame =
  | { type: "token"; text: string }
  | { type: "done"; sources: SourceOut[]; retrieval_mode: RetrievalMode | null }
  | { type: "error"; message: string };

interface SourceOut {
  chunk_id: string;      // UUID
  document_id: string;   // UUID
  document: string;      // filename, NOT a document_id
  page: number | null;
  snippet: string;       // chunk text truncated to 300 chars + "..."
  text: string;          // full chunk text, untruncated
  score: number;              // meaning depends on mode — see below
  source: "semantic" | "keyword" | "both";
  semantic_rank: number | null;   // 1-based position in the semantic leg
  keyword_rank: number | null;    // 1-based position in the keyword leg
}
```

- **The citation/chunk join is done server-side now.** The pre-streaming API
  returned `citations` and `retrieved_chunks` as two parallel arrays the client
  zipped by index; `SourceOut` is that join already performed (on `chunk_id`).
  There is no longer a single JSON body in which "same index" is a guarantee
  worth leaning on.
- **Response headers**: `Cache-Control: no-cache`, `Connection: keep-alive`,
  and `X-Accel-Buffering: no`. The last one is load-bearing in deployment —
  nginx and the proxies in front of Railway/Render/Fly will otherwise buffer
  the whole response and hand the client one delayed blob, so the stream works
  locally and silently stops streaming in production.
- `score` is **not comparable across modes, and doesn't even sort the same
  way**:
  - `semantic` → raw cosine distance from pgvector's `<=>`, **lower is better**
  - `keyword` → `ts_rank_cd`, **higher is better**
  - `hybrid` → RRF fused score (`sum(1/(60+rank))`, typically ~0.01–0.03),
    **higher is better**

  Sources always arrive pre-sorted best-first, so **render them in array order
  and never re-sort by `score` yourself**. Label the score by mode (that's what
  `retrieval_mode` on the `done` frame is for), and never render it as a
  percentage or a fixed-scale bar.
- `source` / `semantic_rank` / `keyword_rank` are what the retrieval debug view
  renders: which leg found the chunk, and where it placed in each. Exactly one
  rank is set for `semantic`/`keyword` mode; under `hybrid`, a chunk with
  `source: "both"` placed in both legs, which is precisely what RRF rewards —
  that's the "semantic vs keyword contribution" story the view is meant to
  tell. At least one rank is always non-null.

**Where failures surface — the status code is not the whole story.** Retrieval
runs to completion *before* the response starts, so its failures are ordinary
HTTP errors (a bad request body still 422s, a database outage still 5xxs).
Generation runs *inside* the body, by which point the `200` status line has
already been sent and cannot be taken back — so a Claude failure arrives as a
terminal **`error` frame inside a `200`**. A client that checks only
`response.ok` and concatenates tokens will render a truncated answer as if it
were complete. There is no `502` from this endpoint once streaming begins.

**FR-10 refusal.** When retrieval returns *nothing* (e.g. no documents ingested
yet), that is a completed answer, not an error: the stream carries the sentence
`"I cannot answer this question based on the available documents."` as its only
`token`, then a `done` frame with `sources: []` and `retrieval_mode: null`. No
`error` frame. Separately, when retrieval *does* return chunks but none are
relevant, Claude is instructed to reply with that same sentence — so the UI
should treat that exact string as "no answer" regardless of whether sources are
present.

**Client disconnect.** The generator polls `Request.is_disconnected()` between
deltas and stops on abort, which closes the Anthropic stream — an abandoned
question stops generating (and billing) rather than running to completion into
a socket nobody is reading.

### `GET /api/v1/livez` / `GET /api/v1/readyz`

- `livez` → `200 {"status": "ok"}`.
- `readyz` → `200 {"status": "ok"}`, or `{"status": "not_ready", "reason": "..."}`
  (still HTTP 200) if the embedding model hasn't loaded. Check the body, not
  just the status code.
- `readyz` checks **two** dependencies but reports them differently: it first
  runs `SELECT 1` against the database, and that failure is *not* caught — an
  unreachable DB propagates and surfaces as a **500**, not a `not_ready` body.
  Only the embedding-model check produces `not_ready`. So a readiness poll has
  to treat a non-200 as "down" *and* inspect the body on a 200.

### Errors

All handled errors return `{"detail": "<message>"}` (`app/main.py`). Surface
`detail` directly in the UI.

| Status | Cause | Frontend handling |
| --- | --- | --- |
| `413` | File over `max_upload_size_mb` (default 20MB) | Validate size client-side first |
| `415` | Unsupported type — only `application/pdf` and `text/plain` | Restrict the file input's `accept` |
| `422` | Extraction failed (corrupt / encrypted / no text layer) **or** FastAPI request validation | Show `detail`; wording differs between the two |
| `502` | Claude API failed *before* a response started | Offer a retry action |

Note `422` is overloaded: it covers both a malformed request body and a
genuinely unreadable document. The message text is the only way to tell.

`502` no longer covers the common Claude failure. `/query` streams, so a
generation failure happens after the `200` is committed and arrives as an SSE
`error` frame instead — see the query contract above.

## Missing / insufficient endpoints for the Week 3 UI

Flagging these now rather than working around them in the client. The one that
blocked `RetrievalDebugView` (per-chunk provenance) is **resolved** — see the
note below; everything still listed is a nice-to-have.

> **Resolved:** streaming. `/query` used to be one blocking response covering
> the whole retrieve + generate round trip, so the chat UI could only show a
> spinner. It now streams over SSE — see the contract above. Retrieval and RRF
> still run to completion first (they aren't streamable); only generation
> streams.
>
> **Resolved:** per-chunk retrieval provenance. `retriever.retrieve()` used to
> discard `semantic_rank`/`keyword_rank` when unwrapping `FusedChunk`, so the
> debug view's whole reason for existing couldn't reach the client. It now
> returns `RankedChunk` (chunk + provenance) for *all three* modes, and
> `RetrievedChunkOut` carries `source` / `semantic_rank` / `keyword_rank`.
> Hybrid's `score` is now the RRF fused score it actually ranked by — it
> previously reported the wrapped chunk's raw per-leg score, which was an
> incomparable mix of cosine distance and `ts_rank_cd` depending on which leg
> saw the chunk first.

1. **No retrieval-only endpoint** (e.g. `POST /api/v1/retrieve`). Comparing all
   three modes side-by-side currently costs three Claude calls, and every debug
   view refresh bills a generation.
2. **No `GET /api/v1/documents/{id}`** and no way to fetch a chunk or page by
   id. "View source" click-through is limited to the 300-char `snippet`; there
   is no full-page or full-document text to expand into.
3. **No document download/preview route** — citations can't link to the
   original PDF page.
4. **No re-index route** (e.g. `POST /api/v1/documents/{id}/reindex`). This
   blocks the library's re-index action outright, and it can't be faked
   client-side: re-uploading would need the original file, which the browser
   can't read back and item 3 above can't fetch. The button is rendered
   disabled so the gap stays visible.
5. **No chunk count on `DocumentOut`.** The library card wants "how many chunks
   did this become", which is the one number that says whether ingestion did
   anything useful — but the schema exposes only `page_count`, and there is no
   chunk endpoint. Cards show pages instead. A `chunk_count` field on
   `DocumentOut` (a `COUNT(*)` against `chunks`) would be the smallest fix.
6. **No upload progress / async ingest status** — see the synchronous-ingestion
   note above; a large PDF is an opaque multi-second wait.
7. **`DELETE` returns `204` for unknown ids** — the UI can't show "already
   deleted".
8. **No pagination on `GET /documents`** — fine at demo scale, will need it if
   the corpus grows.

## Frontend conventions (Week 3)

Stack is **Vite + React 18 + TypeScript (strict) + Tailwind**, scaffolded in
`frontend/`. The shell is real and runs: routing, `AppLayout`, theming, config,
ESLint + Prettier. **`/documents` is fully implemented** — `UploadZone`,
`DocumentCard`, `StatusPill`, `Toast`, `DocumentList` and the `useDocuments`
hook. (`UploadZone` replaced the `FileUpload` stub, which was deleted rather
than left throwing.) Still `TODO` stubs that `throw new Error("Not
implemented")`: `ChatWindow`, `MessageBubble`, `CitationBadge`,
`RetrievalDebugView` and `useChat` — they have real prop types but no bodies.
Fill those in; don't re-scaffold, and don't add dependencies (state libraries,
component kits, fetch wrappers) without asking first.

- **Status colours are three buckets, not four.** `ready` → `success`
  (emerald), `queued`/`embedding` → `accent` (amber), `error` → red. Queued and
  embedding share a colour deliberately: the difference matters to the
  pipeline, not to someone waiting for a document.
- **The library polls, but has nothing to poll for today.** `useDocuments`
  re-fetches every 3s while any document is non-terminal and stops when none
  are, cleaning up on unmount. Because ingestion is synchronous, the list never
  actually contains a non-`ready` document — the loop is there for the day
  ingest moves to a background task. Don't delete it as dead code without
  removing the reason it exists.

- **Routing.** `react-router-dom` v6. Routes live in `src/App.tsx`: `/ask`
  (chat) and `/documents` (library), both inside `AppLayout` via `<Outlet />`.
  `/` and any unknown path redirect to `/ask`. Pages are `src/pages/*Page.tsx`
  and compose feature components — they hold no logic themselves.
- **Path alias `@/` → `src/`.** Declared twice, and both must stay in sync:
  `paths` in `tsconfig.json` (for the typechecker) and `resolve.alias` in
  `vite.config.ts` (for the bundler). Prefer `@/…` over `../../` imports.
- **Theming.** Tailwind `darkMode: "class"`; `src/hooks/useTheme.ts` owns the
  `dark` class on `<html>` and persists to `localStorage` under
  `contextiq-theme`, falling back to `prefers-color-scheme` when nothing is
  stored. An inline script in `index.html` applies the same logic before first
  paint to avoid a flash — **if you change the storage key, change it in both
  places.**
- **Theme tokens.** `primary` (`#4F46E5`, `primary-hover` `#4338CA`), `accent`
  (`#F59E0B`), `success` (`#10B981`) are extended in `tailwind.config.js`;
  surfaces/text/borders use Tailwind's built-in `slate` scale. Note Tailwind
  only emits classes it sees used, so `accent`/`success` won't appear in the
  built CSS until something references them — that's not a misconfiguration.
- **Config.** `src/config.ts` is the only module that reads `import.meta.env`
  (mirroring the backend's `core/config.py` rule). `VITE_API_BASE_URL` is empty
  by default so requests stay same-origin and go through the Vite dev proxy
  (`/api` → `localhost:8000`); set it to an absolute origin to bypass the proxy,
  and add that origin to the backend's `Settings.cors_origins`.
- **Functional components only.** No class components, no `React.FC` — type
  props via an explicit `interface FooProps` and annotate the return as
  `JSX.Element`. Default-export one component per file.
- **Colocate.** A component owns its file in `src/components/`; component-local
  helpers and types live in that same file (see `ThemeToggle`'s icons). Only
  genuinely shared things get promoted — wire types to `src/types/`, HTTP calls
  to `src/api/client.ts`.
- **All network access goes through `src/api/client.ts`.** No `fetch` in a
  component or hook. The client throws a typed `ApiError` (carrying `status`
  and the server's `detail` as its `message`) on non-2xx. `src/lib/api.ts` is a
  thin re-export of the same module, so `@/lib/api` and `@/api/client` are the
  same thing — add functions to the client, never to the shim.
- **`src/types/index.ts` mirrors the backend Pydantic schemas verbatim**, in
  snake_case — keep it that way when the API changes. The client layers a
  UI-facing vocabulary on top of it and is the *only* place that translates:
  status `pending|processing|ready|failed` → `queued|embedding|ready|error`,
  and chunk source `semantic|keyword|both` → `vector|keyword|fused`. Both maps
  are 1:1; field names are **not** translated (still snake_case).
- **State lives in hooks**, not components: `useChat.ts` owns message history
  and drives `askQuestion`. Components render; hooks orchestrate.
- **`askQuestion` is an async generator over the SSE stream.** It yields a
  `token` event per delta and a final `done` event carrying the sources, and
  **throws** an `ApiError` on an `error` frame — so a caller that only
  accumulates tokens can't mistake a failed generation for a finished answer.
  Abandoning the generator (`break`, or an aborted `AbortSignal`) cancels the
  response body, which stops generation server-side.
- **The SSE parser is hand-rolled, not `EventSource`.** `EventSource` is
  GET-only and `/query` needs a POST body. It buffers until a `\n\n`
  terminator rather than parsing per network chunk, because a chunk boundary
  can fall mid-JSON.
- **Tailwind utilities in JSX.** No CSS modules, no styled-components; global
  CSS in `src/index.css` stays limited to the Tailwind directives.
- **Named exports for hooks and API functions; default export for components.**
- **ESLint + Prettier are wired up** (`eslint.config.js` flat config,
  `.prettierrc.json`). `npm run lint`, `npm run format`, `npm run typecheck`;
  CI runs lint + format-check + typecheck + build. Prettier owns formatting —
  `eslint-config-prettier` is last in the config so no lint rule fights it.
- **Unit tests run on Vitest** — `npm run test` (`test:watch` to iterate). There
  is no separate Vitest config: it reads `vite.config.ts`, so the `@/` alias
  works in tests without declaring it a third time. Note CI does **not** run
  `npm run test` yet — add it to `.github/workflows/ci.yml` alongside the other
  frontend steps.
- Keep the module-boundary discipline the backend uses: `components/` never
  imports from `api/` directly (go through a hook), and `api/` never imports
  from `components/`.
- Every file gets the same one-line "single responsibility" header comment the
  existing stubs use — match that style.
