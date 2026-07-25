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

export interface CitationOut {
  /** Filename, not an id -- join via chunk_id to reach the document. */
  document: string;
  page: number | null;
  chunk_id: string;
  /** Chunk text truncated to 300 chars. */
  snippet: string;
}

export interface RetrievedChunkOut {
  chunk_id: string;
  document_id: string;
  text: string;
  page: number | null;
  /**
   * Only comparable within a single mode: cosine distance for semantic
   * (lower is better), ts_rank_cd for keyword and the RRF fused score for
   * hybrid (higher is better). Results arrive pre-sorted best-first, so
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

export interface AnswerResponse {
  answer: string;
  citations: CitationOut[];
  retrieved_chunks: RetrievedChunkOut[];
  /** Null on the "no context found" refusal, which is a 200 with empty
   *  citations and chunks -- not an error status. */
  retrieval_mode: RetrievalMode | null;
}
