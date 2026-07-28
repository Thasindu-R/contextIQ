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

// The pre-streaming API returned `citations` and `retrieved_chunks` as two
// parallel arrays the client had to zip by index. /query now streams, and
// the terminal `done` frame carries that join already done -- see SourceOut
// below. The two shapes those arrays used (CitationOut, RetrievedChunkOut)
// are gone rather than kept "just in case": nothing on the wire produces
// them any more, so leaving them here would only invite new code to be
// written against a contract the backend no longer speaks.

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
 * One retrieved chunk joined with its citation, as sent in the `done`
 * frame (FR-9/FR-15).
 *
 * The pre-streaming API returned `citations` and `retrieved_chunks` as
 * two parallel arrays the client had to zip by index. A stream has no
 * single JSON body in which "same index" is a guarantee, so the backend
 * sends the join already done -- filename and page from the citation,
 * score and provenance from the chunk.
 */
export interface SourceOut {
  chunk_id: string;
  document_id: string;
  /** Filename. */
  document: string;
  page: number | null;
  /** Chunk text truncated to 300 chars. */
  snippet: string;
  /** Full chunk text, untruncated. */
  text: string;
  /**
   * Only comparable within a single mode: cosine distance for semantic
   * (lower is better), ts_rank_cd for keyword and the RRF fused score
   * for hybrid (higher is better). Sources arrive pre-sorted best-first,
   * so render them in array order rather than re-sorting on this.
   */
  score: number;
  source: RetrievalSource;
  /** 1-based position in that leg, or null if it didn't place there. */
  semantic_rank: number | null;
  keyword_rank: number | null;
}

/** One text delta from the model, in generation order. */
export interface TokenFrame {
  type: "token";
  text: string;
}

/** Terminal frame on a successful stream -- exactly one, last. */
export interface DoneFrame {
  type: "done";
  sources: SourceOut[];
  /** Null on the FR-10 refusal, where retrieval found nothing. */
  retrieval_mode: RetrievalMode | null;
}

/**
 * Terminal frame when generation fails -- sent *instead of* `done`.
 *
 * Once the body has started the status code is committed to 200, so an
 * upstream failure can only be reported in-band. `message` carries what
 * the pre-streaming path put in a 502's `detail`.
 */
export interface ErrorFrame {
  type: "error";
  message: string;
}

export type QueryStreamFrame = TokenFrame | DoneFrame | ErrorFrame;
