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
  score: number;              // meaning depends on mode — see below
  source: "semantic" | "keyword" | "both";
  semantic_rank: number | null;   // 1-based position in the semantic leg
  keyword_rank: number | null;    // 1-based position in the keyword leg
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
- `source` / `semantic_rank` / `keyword_rank` are what the retrieval debug view
  renders: which leg found the chunk, and where it placed in each. Exactly one
  rank is set for `semantic`/`keyword` mode; under `hybrid`, a chunk with
  `source: "both"` placed in both legs, which is precisely what RRF rewards —
  that's the "semantic vs keyword contribution" story the view is meant to
  tell. At least one rank is always non-null.

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

Flagging these now rather than working around them in the client. The one that
blocked `RetrievalDebugView` (per-chunk provenance) is **resolved** — see the
note below; everything still listed is a nice-to-have.

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
4. **No streaming** — `/query` is one blocking response, so the chat UI shows a
   spinner for the full retrieve + generate round trip instead of streaming
   tokens.
5. **No upload progress / async ingest status** — see the synchronous-ingestion
   note above; a large PDF is an opaque multi-second wait.
6. **`DELETE` returns `204` for unknown ids** — the UI can't show "already
   deleted".
7. **No pagination on `GET /documents`** — fine at demo scale, will need it if
   the corpus grows.

## Frontend conventions (Week 3)

Stack is **Vite + React 18 + TypeScript (strict) + Tailwind**, scaffolded in
`frontend/`. The shell is real and runs: routing, `AppLayout`, theming, config,
ESLint + Prettier. The **`/ask` chat screen is built** — `ChatWindow`,
`MessageList`, `MessageBubble`, `CitationChip`, `ChatInput`, `DocumentFilter`,
`SourcesPanel`, `CitationBadge`, `useChat`, `useDocuments`, `useToast`, the
`components/ui/` primitives, and the `listDocuments` / `submitQuery` /
`askQuestion` client calls. `FileUpload`, `DocumentList`,
`RetrievalDebugView`, and the `uploadDocument` / `deleteDocument` client
calls are still `TODO` stubs that
`throw new Error("Not implemented")` — they have real prop types but no bodies.
Fill those in; don't re-scaffold, and don't add dependencies (state libraries,
component kits, fetch wrappers) without asking first.

- **The chat consumes an answer as a stream.** `api/client.askQuestion()` is an
  async generator yielding `token` frames then one terminal `done` frame
  (sources, retrieved chunks, retrieval mode), and it *throws* rather than
  yielding on failure — an error frame and today's 502 land on the same catch.
  The backend has no SSE route yet, so it currently wraps the one blocking
  `POST /query` and emits the whole answer as a single token. **The UI must not
  special-case that**: render tokens as they arrive so a real event-stream
  reader dropped into that one function makes the chat incremental for free.
- **Empty retrieval is not an error path.** The FR-10 refusal arrives as a
  normal completed answer whose `sources` is empty and whose `retrieval_mode`
  is null. It renders as an ordinary assistant bubble; only a thrown error
  frame produces the error state (with Retry).
- **Chat state is a `useReducer` in `useChat`.** Messages carry a
  `pending | streaming | complete | error` status — `pending` is the typing
  indicator. `activeCitation` (hovered, transient) and `pinnedCitation`
  (clicked, sticky) live there too, so the Sources panel can highlight the
  source a `CitationChip` points at.
- **Citation markers are parsed, not assumed.** `MessageBubble` turns `[1]`,
  `[1, 2]`, and `[Source 1]` into chips only when every number resolves to a
  source; anything else stays literal text, so an unsourced answer never grows
  a chip pointing nowhere.
- **`SourcesPanel` is the retrieval story, and it obeys the score rules.**
  Score meaning and *direction* come from the answer's `retrieval_mode`:
  semantic is a cosine distance (lower is nearer), keyword `ts_rank_cd` and
  hybrid RRF are strengths (higher is stronger). It prints the raw number with
  a per-mode direction hint and never normalises, re-sorts, percentage-ifies,
  or bar-charts it — chunks render in the order the API returned them. A null
  `retrieval_mode` is the no-context answer and gets the empty state, not an
  error. `RetrievalDebugView` is still a stub; the panel already renders the
  `source` / `semantic_rank` / `keyword_rank` provenance it was meant to show,
  so decide whether that stub still earns its place before filling it in.
- **Reach for `components/ui/` before writing utility soup.** `Button`,
  `IconButton` (which *requires* a `label`, so an icon button cannot ship
  without an accessible name), `Pill`, `Card`, `Skeleton`, `EmptyState`,
  `ToastRegion`, and the `FOCUS_RING` / `FOCUS_RING_TIGHT` constants. They are
  deliberately thin — variants and tones only, no polymorphic `as` sprawl
  beyond `Card`'s `div | li`. Add a variant rather than a one-off class
  string; add a primitive only when a pattern repeats a third time.
- **Errors: toast the ambient ones, inline the ones that own a retry.** A
  failed document load or a blocked clipboard write raises a toast via
  `useToast()` (the provider is mounted once, in `main.tsx`). A failed answer
  stays inline on its message bubble, because the Retry action belongs to that
  turn and a toast that disappears cannot carry it.
- **Dark mode is not optional per class.** Every colour utility that differs
  between themes ships its `dark:` counterpart in the same class string —
  including `focus-visible:ring-offset-*`, which otherwise punches a white
  halo through dark surfaces. Brand tokens (`primary`, `accent`) are
  intentionally theme-independent.
- **Layout is viewport-height, not page-height.** `AppLayout` is `h-dvh` with
  `overflow-hidden`; scrolling belongs to the inner regions, because the chat
  route divides a definite height between thread, composer and sources rail.
  The shell stacks to a top bar under `md`, and chat and sources stack under
  `lg` with the panel height-capped. Anything new inside `/ask` needs
  `min-h-0` on its flex parents or the inner scrolling silently breaks.

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
  component or hook. The client returns typed wire shapes and throws on non-2xx
  after reading `detail`.
- **`src/types/index.ts` mirrors the backend Pydantic schemas verbatim**, in
  snake_case — keep it that way when the API changes.
- **State lives in hooks**, not components: `useChat.ts` owns message history
  and calls `submitQuery`. Components render; hooks orchestrate.
- **Tailwind utilities in JSX.** No CSS modules, no styled-components; global
  CSS in `src/index.css` stays limited to the Tailwind directives.
- **Named exports for hooks and API functions; default export for components.**
- **ESLint + Prettier are wired up** (`eslint.config.js` flat config,
  `.prettierrc.json`). `npm run lint`, `npm run format`, `npm run typecheck`;
  CI runs lint + format-check + typecheck + build. Prettier owns formatting —
  `eslint-config-prettier` is last in the config so no lint rule fights it.
- Keep the module-boundary discipline the backend uses: `components/` never
  imports from `api/` directly (go through a hook), and `api/` never imports
  from `components/`.
- Every file gets the same one-line "single responsibility" header comment the
  existing stubs use — match that style.
