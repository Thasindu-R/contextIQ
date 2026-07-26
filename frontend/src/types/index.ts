// Shared frontend types mirroring backend Pydantic schemas.
// Single responsibility: type definitions only, no logic.
//
// These are wire types: snake_case, matching the backend field names
// exactly. The API does no camelCase conversion -- see the API contract in
// the repo-root CLAUDE.md.

export type RetrievalMode = "semantic" | "keyword" | "hybrid";

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

/** Which search leg surfaced a chunk. "both" means it placed in the
 *  semantic and keyword legs of a hybrid search -- what RRF rewards. */
export type RetrievalSource = "semantic" | "keyword" | "both";

export interface DocumentOut {
  id: string;
  filename: string;
  /** ISO 8601 datetime. */
  upload_time: string;
  status: DocumentStatus;
  page_count: number | null;
}

/**
 * One retrieved chunk joined with its citation, as sent in the `done`
 * frame. The backend does the join (on chunk_id) -- there are no longer
 * two parallel arrays for the client to zip.
 */
export interface SourceOut {
  chunk_id: string;
  document_id: string;
  /** Filename, not an id. */
  document: string;
  page: number | null;
  /** Chunk text truncated to 300 chars. */
  snippet: string;
  /** Full, untruncated chunk text. */
  text: string;
  /**
   * Only comparable within a single mode: cosine distance for semantic
   * (lower is better), ts_rank_cd for keyword and the RRF fused score for
   * hybrid (higher is better). Sources arrive pre-sorted best-first, so
   * render them in array order rather than re-sorting on this.
   */
  score: number;
  source: RetrievalSource;
  /** 1-based position in that leg, or null if it didn't place there. */
  semantic_rank: number | null;
  keyword_rank: number | null;
}

export interface QueryRequest {
  question: string;
  /** Omit or null to search every document. */
  document_ids?: string[] | null;
  top_k?: number;
  /** Note: the request field is `mode`; the response field is
   *  `retrieval_mode`. They differ deliberately. */
  mode?: RetrievalMode;
}

/**
 * Frames of the `POST /api/v1/query` SSE stream, one per `data:` line.
 *
 * Order is: zero or more `token`, then exactly one terminal frame --
 * `done` on success, `error` if generation failed. An `error` frame
 * arrives inside a 200, because the status line is already sent by the
 * time generation can fail.
 */
export interface TokenFrame {
  type: "token";
  text: string;
}

export interface DoneFrame {
  type: "done";
  sources: SourceOut[];
  /** Null on the "no context found" refusal, which is a normal
   *  completed answer with no sources -- not an error. */
  retrieval_mode: RetrievalMode | null;
}

export interface ErrorFrame {
  type: "error";
  message: string;
}

export type QueryStreamFrame = TokenFrame | DoneFrame | ErrorFrame;

// ---------------------------------------------------------------------------
// UI-facing types
//
// Everything above mirrors the backend's Pydantic schemas verbatim. The
// types below are the vocabulary the UI renders in; `api/client.ts` is
// the only module that converts between the two. They live here rather
// than in `api/` so components can name them without importing from the
// network layer (see the module-boundary rule in CLAUDE.md).
// ---------------------------------------------------------------------------

/** Which retrieval leg surfaced a chunk. Maps 1:1 from `RetrievalSource`. */
export type RetrieverSource = "vector" | "keyword" | "fused";

/** A retrieved chunk joined with its citation, in UI vocabulary. */
export interface Source {
  chunk_id: string;
  document_id: string;
  /** Filename, from the citation. */
  document: string;
  page: number | null;
  /** Chunk text truncated to 300 chars. */
  snippet: string;
  /** Full, untruncated chunk text. */
  text: string;
  /**
   * Only comparable within a single mode: cosine distance for `vector`
   * (lower is better), ts_rank_cd for `keyword` and the RRF fused score for
   * hybrid (higher is better). Sources arrive pre-sorted best-first --
   * render in array order and never re-sort on this, and never show it as a
   * percentage or a fixed-scale bar.
   */
  score: number;
  retriever: RetrieverSource;
  /** 1-based position in that leg, or null if it didn't place there. */
  vector_rank: number | null;
  keyword_rank: number | null;
}
