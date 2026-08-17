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
  evaluation/        fixed corpus + eval_set.json, corpus/metrics/report/run_eval
                     (semantic vs keyword vs hybrid)
  tests/
frontend/
  src/
    api/client.ts
    components/      ChatWindow, SourcesPanel, FileUpload, CitationBadge, ...
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
  - **The keyword leg ORs its terms** (`chunk_repo._to_or_query_text`), and
    `ts_rank_cd` does the discriminating. It used to AND them, which meant a
    query phrased as a question demanded one chunk contain every content word;
    nothing matched, and hybrid silently collapsed to semantic-only. Recall is
    this leg's job — precision comes from ranking, `top_k`, and RRF. As a
    consequence websearch operators (`"quoted phrases"`, `-negation`, explicit
    `or`) are stripped rather than honoured: OR-ing a negation in would match
    nearly the whole corpus. Nothing in the UI offers that syntax.
  - **The keyword leg's `ORDER BY` carries a tiebreak** (`rank DESC,
    chunk_index, id`). OR-ed terms make `ts_rank_cd` ties common, and
    `ORDER BY rank DESC LIMIT k` alone let PostgreSQL return tied rows in any
    order — so the same question could return a *different set of sources* on
    consecutive runs. The evaluation harness is what caught it, as keyword MRR
    drifting between identical runs. Don't drop the tiebreak.
- **`generation/`** (`claude_client.py`, `prompt_builder.py`): owns building the
  grounded prompt and calling Claude. Never queries the database or performs
  retrieval itself — it only accepts chunks that were already retrieved.
- **`api/`**: routes + request/response wiring only. No extraction, retrieval, or
  generation logic lives here — routes call into `services/`, which orchestrates
  `ingestion/`, `retrieval/`, `generation/`, and `repositories/`.
- **`evaluation/`** sits *outside* these four layers: it is a harness, not a
  request path, so it is allowed to orchestrate across them the way `services/`
  does. It must keep doing so through the shipped entry points
  (`document_service.upload_document`, `retriever.retrieve`,
  `qa_service.stream_answer`) — an evaluation that ingested or retrieved by a
  shortcut would be measuring a pipeline nobody runs.

Rule of thumb: a file in one of these four layers should never import
implementation internals from another layer — only the narrow function
signatures each module exposes (e.g. `retriever.retrieve(...)`,
`generation.generate(...)`).

## Delivery status: all four weeks complete

Per the delivery timeline: Week 1 (ingestion pipeline) and Week 2 (semantic +
keyword retrieval, RRF fusion, grounded Claude generation with citations,
`/query` endpoint) are complete — verified by an end-to-end integration test
(`tests/test_query_api.py`) that ingests a document over the real API and
asks a question against it, confirming a grounded answer with correct
citations, plus a graceful "cannot answer" refusal (never a 500) for both an
empty-retrieval query and an off-topic question answered by Claude itself.
Week 3 (frontend + retrieval debug view, which `SourcesPanel` is) and Week 4
(the evaluation harness) are complete too. **All four weeks are delivered**, so
there is no longer a "current week" to work ahead of — new work is maintenance
or a deliberate extension, not timeline scope.

> **Branch state.** All four weeks are on `main` and verified end-to-end: the
> Week 2 backend landed via PR #2, the reconciled Week 3 frontend (and the
> streaming `/query`) via PR #9, containerization plus the end-to-end fix pass
> on top of that, and the Week 4 evaluation harness after it. 96 backend tests
> and 55 frontend tests pass, and the stack has been exercised through a
> browser — upload, ask, cited answer, delete — against a real
> Postgres+pgvector.
>
> The older `worktree-query-endpoint`, `worktree-generation-claude-api`, and
> `worktree-week3-*` branches are **superseded**; their work is included in
> what was merged. Don't build against them.

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

### Errors

All handled errors return `{"detail": "<message>"}` (`app/main.py`). Surface
`detail` directly in the UI.

| Status | Cause | Frontend handling |
| --- | --- | --- |
| `413` | File over `max_upload_size_mb` (default 20MB) | Validate size client-side first |
| `415` | Unsupported type — only `application/pdf` and `text/plain` | Restrict the file input's `accept` |
| `422` | Extraction failed (corrupt / encrypted / no text layer) **or** FastAPI request validation | Show `detail`; wording differs between the two |
| `502` | Claude API failed after SDK retries. **Only reachable outside `/query`** — once that stream has opened, a generation failure is an in-band `error` frame inside a `200`, and the client throws on it | Offer a retry action |

Note `422` is overloaded: it covers both a malformed request body and a
genuinely unreadable document. The message text is the only way to tell.

## Missing / insufficient endpoints for the Week 3 UI

Flagging these now rather than working around them in the client. The one that
blocked the retrieval debug view (per-chunk provenance) is **resolved** — see
the note below; everything still listed is a nice-to-have.

> **Resolved:** per-chunk retrieval provenance. `retriever.retrieve()` used to
> discard `semantic_rank`/`keyword_rank` when unwrapping `FusedChunk`, so the
> debug view's whole reason for existing couldn't reach the client. It now
> returns `RankedChunk` (chunk + provenance) for *all three* modes, and
> `SourceOut` carries `source` / `semantic_rank` / `keyword_rank`.
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
4. **No upload progress / async ingest status** — see the synchronous-ingestion
   note above; a large PDF is an opaque multi-second wait.
5. **`DELETE` returns `204` for unknown ids** — the UI can't show "already
   deleted".
6. **No pagination on `GET /documents`** — fine at demo scale, will need it if
   the corpus grows.

## Frontend conventions (Week 3)

Stack is **Vite + React 18 + TypeScript (strict) + Tailwind**, scaffolded in
`frontend/`. The shell is real and runs: routing, `AppLayout`, theming, config,
ESLint + Prettier. The **`/ask` chat screen is built** — `ChatWindow`,
`MessageList`, `MessageBubble`, `CitationChip`, `ChatInput`, `DocumentFilter`,
`SourcesPanel`, `CitationBadge`, `useChat`, `useToast`, and the
`components/ui/` primitives. The `/documents` library screen is built too —
`FileUpload`, `DocumentList`, `StatusPill`, `useDocuments` — so every client
call (`listDocuments` / `uploadDocument` / `deleteDocument` / `submitQuery` /
`askQuestion`) is now real. **There are no `TODO` stubs left** — the last one,
`RetrievalDebugView`, was deleted rather than filled in (see the retrieval
debug view note below). Don't re-scaffold, and don't add dependencies (state
libraries, component kits, fetch wrappers) without asking first.

- **The chat consumes an answer as a real stream.** `api/client.askQuestion()`
  is an async generator over the `text/event-stream` body of `POST /query`: it
  yields `token` frames as they arrive, then one terminal `done` frame
  (pre-joined sources + retrieval mode), and it *throws* an `ApiError` on an
  `error` frame rather than yielding it — so a caller that only accumulates
  tokens can never mistake a failed generation for a finished answer. The SSE
  reader is hand-rolled because `EventSource` is GET-only and `/query` needs a
  POST body; it buffers to `\n\n` because a network chunk boundary can fall
  mid-JSON. Abandoning the generator cancels the body, which stops generation
  server-side instead of billing into a stream nobody reads.
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
  error. **`SourcesPanel` *is* the retrieval debug view** — there is no
  separate component. A `RetrievalDebugView` stub used to sit alongside it
  throwing `Not implemented`; it was deleted rather than completed, because
  this panel already renders the `source` / `semantic_rank` / `keyword_rank`
  provenance it was specced for, and its props were typed against
  `RetrievedChunkOut` — the shape `/query` stopped returning when it became a
  stream.
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
- **Tests are Vitest + React Testing Library, with `@/api/client` mocked.**
  `npm test` (CI runs it between typecheck and build). Setup lives in
  `src/test/setup.ts` — jsdom has no `scrollIntoView` and no `matchMedia`, and
  both are called during render, so they are stubbed there. Vitest globals are
  off: import `describe`/`it`/`expect` explicitly. `vi.mock` is hoisted above
  the file's consts, so build spies inside `vi.hoisted`.
  - **`userEvent.upload` applies the input's `accept` filter**, so it cannot
    deliver an unsupported type. Test rejection of a wrong file type via
    `fireEvent.drop`, which is also the only way a user really gets one past
    the picker.
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

## Evaluation harness (Week 4)

`backend/evaluation/` — `corpus.py` (load the eval set, ingest the corpus,
resolve ground truth), `metrics.py` (pure scoring), `report.py` (result shapes,
aggregation, table rendering), `run_eval.py` (CLI + orchestration). Run it with
`make eval`, or `python -m evaluation.run_eval [--top-k N] [--retrieval-only]
[--modes ...] [--reingest] [--verbose] [--json PATH]`.

- **Ground truth is `locators`, not chunk ids.** Chunk ids are generated per
  ingest, so `eval_set.json` identifies relevant passages by verbatim substrings
  of the source document and `resolve_ground_truth` maps them onto this run's
  chunk ids. A locator must sit inside one chunk — if it straddles a boundary
  the run **fails loudly** rather than scoring against ground truth that
  resolves to nothing, which would deflate every mode equally and read as a
  retrieval regression. `tests/test_evaluation.py` checks every shipped locator
  against the corpus without needing a database.
- **The corpus is reused between runs, not re-ingested.** Re-ingesting
  regenerates chunk ids, which reshuffles `ts_rank_cd` ties and moves the
  reported numbers by a question or two. `--reingest` after editing the corpus.
- **`metrics.py` is pure and deterministic — keep it that way.** No LLM judge:
  a metric that varies run to run cannot compare three retrieval modes. Answer
  scoring is therefore lexical (SQuAD-style token F1) and `fact_coverage` is
  what catches a fluent answer carrying the wrong number.
- **Modes are interleaved per question, with the order rotating.** Both matter
  for the latency column: run as consecutive blocks, whichever mode went first
  looked ~2ms/query slower even after warm-up — enough to show hybrid beating
  the semantic leg it contains. Interleaving without rotating just moved the
  penalty, since semantic and hybrid embed the same question text and the
  second one to run reads a warm cache.
- **Unanswerable pairs (`document: null`) are excluded from retrieval
  aggregates** and scored on refusal instead — there is no correct chunk for
  them to find, so folding them in would measure nothing while dragging every
  mode down identically.
- **A placeholder `CLAUDE_API_KEY` degrades to retrieval-only** with a notice,
  rather than firing 60-odd doomed requests and printing zeroes as if answer
  quality had been measured.
- **Don't tune the corpus or the eval set to make hybrid win.** It currently
  doesn't, on every metric — hybrid takes hit@3 and loses MRR to semantic-only.
  That mixed result is the finding; the README states it plainly.
