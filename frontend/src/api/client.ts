// Typed REST client to the backend API.
// Single responsibility: HTTP calls only, no UI or state logic. Every
// network call in the app goes through this module.
//
// Two vocabularies meet here. `@/types` mirrors the backend's Pydantic
// schemas verbatim (snake_case, wire values); the types exported below are
// the UI-facing shapes. Field names stay identical to the wire on purpose
// -- only the two *enum vocabularies* are translated, because the wire
// values read poorly in a UI ("processing", "both"). The mappings are 1:1
// and lossless, and `toDocument` / `toSource` are the only places that
// know about the difference.

import { apiUrl } from "@/config";
import type {
  AnswerResponse,
  CitationOut,
  DocumentOut,
  DocumentStatus as WireDocumentStatus,
  QueryRequest,
  RetrievalMode,
  RetrievalSource,
  RetrievedChunkOut,
} from "@/types";

/** Every route is mounted under this prefix -- health probes included. */
const API_PREFIX = "/api/v1";

export function endpoint(path: string): string {
  return apiUrl(`${API_PREFIX}${path}`);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A non-2xx response from the backend.
 *
 * `message` is the server's own `detail` string (every handled error returns
 * `{"detail": "..."}`), so it is safe to render directly. `status` carries
 * the meaning the UI branches on: 413 too large, 415 wrong type, 422 either
 * an unreadable document *or* request validation, 502 Claude failed.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    // Required for `instanceof` to survive the ES5 downlevel of Error.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Narrowing helper so callers don't have to import the class to test it. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Pull a human-readable message out of an error response.
 *
 * Handled backend errors are `{"detail": "<string>"}`. FastAPI's *own*
 * request-validation 422 is different -- there `detail` is an array of
 * error objects -- and a proxy or dev-server failure may not be JSON at
 * all. All three have to produce something renderable rather than throwing
 * a second time while handling the first error.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const fallback = response.statusText || `HTTP ${response.status}`;

  let body: string;
  try {
    body = await response.text();
  } catch {
    return fallback;
  }
  if (!body) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && "detail" in parsed) {
      const { detail } = parsed as { detail: unknown };
      if (typeof detail === "string") {
        return detail;
      }
      // Validation errors: summarise rather than dumping raw objects.
      if (Array.isArray(detail)) {
        const messages = detail
          .map((item) =>
            item !== null && typeof item === "object" && "msg" in item
              ? String((item as { msg: unknown }).msg)
              : null,
          )
          .filter((msg): msg is string => msg !== null);
        if (messages.length > 0) {
          return messages.join("; ");
        }
      }
      return JSON.stringify(detail);
    }
  } catch {
    // Not JSON (an HTML error page, say) -- fall through to the raw body.
  }

  return body;
}

/**
 * The single fetch used by every function below.
 *
 * Prepends the configured API base URL, sets JSON headers (except for
 * multipart uploads, where the browser must set its own boundary), and
 * converts any non-2xx into an ApiError carrying the server's message.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(endpoint(path), {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }

  // 204 (delete) has no body to parse.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** UI-facing ingestion state. Maps 1:1 from the wire values. */
export type DocumentStatus = "queued" | "embedding" | "ready" | "error";

const STATUS_FROM_WIRE: Record<WireDocumentStatus, DocumentStatus> = {
  pending: "queued",
  processing: "embedding",
  ready: "ready",
  failed: "error",
};

export interface Document {
  id: string;
  filename: string;
  /** ISO 8601 datetime. */
  upload_time: string;
  status: DocumentStatus;
  page_count: number | null;
}

function toDocument(wire: DocumentOut): Document {
  return {
    id: wire.id,
    filename: wire.filename,
    upload_time: wire.upload_time,
    status: STATUS_FROM_WIRE[wire.status],
    page_count: wire.page_count,
  };
}

/**
 * Upload a single document and wait for it to be ingested.
 *
 * Ingestion is synchronous server-side -- extract, chunk, embed and persist
 * all happen before the response -- so the returned document is already
 * `"ready"`. There is no progress endpoint; expect a slow request for a
 * large PDF and show an indeterminate spinner.
 *
 * The endpoint is batch-native (`files`, repeatable, returning an array).
 * This sends one file and unwraps the single result. If you ever send a
 * batch, note that a mid-batch failure leaves earlier files committed and
 * returns no body saying which -- re-fetch `listDocuments()` after any
 * upload error rather than trusting local state.
 */
export async function uploadDocument(file: File): Promise<Document> {
  const form = new FormData();
  form.append("files", file);

  const documents = await request<DocumentOut[]>("/documents", {
    method: "POST",
    body: form,
  });
  return toDocument(documents[0]);
}

/** List every document, newest first. No pagination server-side. */
export async function listDocuments(): Promise<Document[]> {
  const documents = await request<DocumentOut[]>("/documents");
  return documents.map(toDocument);
}

/**
 * Fetch one document by id.
 *
 * NOTE: there is no `GET /api/v1/documents/{id}` endpoint. This filters the
 * full list client-side, which is correct but costs a full list request per
 * lookup -- fine at demo scale, worth a real endpoint before the corpus
 * grows. The 404 is synthesised here; the server never sends one.
 */
export async function getDocument(id: string): Promise<Document> {
  const documents = await listDocuments();
  const found = documents.find((document) => document.id === id);
  if (!found) {
    throw new ApiError(404, `Document ${id} not found`);
  }
  return found;
}

/**
 * Delete a document and its chunks.
 *
 * Idempotent server-side: an unknown id also returns 204, so a resolved
 * promise does not prove the document existed.
 */
export async function deleteDocument(id: string): Promise<void> {
  await request<void>(`/documents/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

/** Which retrieval leg surfaced a chunk. Maps 1:1 from the wire values. */
export type RetrieverSource = "vector" | "keyword" | "fused";

const RETRIEVER_FROM_WIRE: Record<RetrievalSource, RetrieverSource> = {
  semantic: "vector",
  keyword: "keyword",
  both: "fused",
};

/**
 * One retrieved chunk, joined with its citation.
 *
 * `citations` and `retrieved_chunks` come back as parallel arrays over the
 * same chunks in the same order, so this zips them: the citation supplies
 * the document *name* and the snippet, the chunk supplies the score and
 * provenance.
 */
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

function toSource(chunk: RetrievedChunkOut, citation: CitationOut | undefined): Source {
  return {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    document: citation?.document ?? "",
    page: chunk.page,
    snippet: citation?.snippet ?? chunk.text.slice(0, 300),
    text: chunk.text,
    score: chunk.score,
    retriever: RETRIEVER_FROM_WIRE[chunk.source],
    vector_rank: chunk.semantic_rank,
    keyword_rank: chunk.keyword_rank,
  };
}

/** The exact sentence the backend uses to refuse, from either refusal path. */
export const NO_ANSWER_TEXT = "I cannot answer this question based on the available documents.";

export type AskEvent =
  | { type: "token"; text: string }
  | { type: "sources"; sources: Source[]; mode: RetrievalMode | null };

export interface AskOptions {
  documentIds?: string[] | null;
  topK?: number;
  mode?: RetrievalMode;
  signal?: AbortSignal;
}

/**
 * Ask a question, yielding answer tokens and then the sources.
 *
 * IMPORTANT -- this does not currently stream. `POST /api/v1/query` is a
 * single blocking response covering the whole retrieve-then-generate round
 * trip; there is no SSE endpoint to consume, so this yields exactly one
 * `token` event holding the complete answer, followed by one `sources`
 * event. The async-generator shape is the point: it is the seam that lets
 * the UI be written once. When the backend grows a `text/event-stream`
 * route, only the body of this function changes -- callers keep working and
 * simply start seeing many `token` events instead of one.
 *
 * Retrieval returning nothing is *not* an error: it comes back as a 200
 * with `NO_ANSWER_TEXT`, no sources, and a null mode. Claude is also told
 * to reply with that same sentence when the retrieved chunks turn out to be
 * irrelevant, so treat the string as "no answer" whether or not sources
 * are present.
 */
export async function* askQuestion(
  question: string,
  options: AskOptions = {},
): AsyncGenerator<AskEvent, void> {
  const body: QueryRequest = {
    question,
    document_ids: options.documentIds ?? null,
    ...(options.topK !== undefined ? { top_k: options.topK } : {}),
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
  };

  const answer = await request<AnswerResponse>("/query", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options.signal,
  });

  yield { type: "token", text: answer.answer };
  yield {
    type: "sources",
    sources: answer.retrieved_chunks.map((chunk, index) =>
      toSource(chunk, answer.citations[index]),
    ),
    mode: answer.retrieval_mode,
  };
}

/**
 * Non-streaming convenience wrapper over `askQuestion`, for callers that
 * only want the finished answer.
 */
export async function ask(
  question: string,
  options: AskOptions = {},
): Promise<{ answer: string; sources: Source[]; mode: RetrievalMode | null }> {
  let answer = "";
  let sources: Source[] = [];
  let mode: RetrievalMode | null = null;

  for await (const event of askQuestion(question, options)) {
    if (event.type === "token") {
      answer += event.text;
    } else {
      sources = event.sources;
      mode = event.mode;
    }
  }

  return { answer, sources, mode };
}
