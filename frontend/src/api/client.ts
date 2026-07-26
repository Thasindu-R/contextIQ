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
  DocumentOut,
  DocumentStatus as WireDocumentStatus,
  QueryRequest,
  QueryStreamFrame,
  RetrievalMode,
  RetrievalSource,
  RetrieverSource,
  Source,
  SourceOut,
} from "@/types";

// Re-exported so `@/lib/api` consumers can name the shapes this module
// returns without a second import. They are defined in `@/types`, next
// to the wire types they translate from.
export type { RetrieverSource, Source };

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

const RETRIEVER_FROM_WIRE: Record<RetrievalSource, RetrieverSource> = {
  semantic: "vector",
  keyword: "keyword",
  both: "fused",
};

function toSource(wire: SourceOut): Source {
  return {
    chunk_id: wire.chunk_id,
    document_id: wire.document_id,
    document: wire.document,
    page: wire.page,
    snippet: wire.snippet,
    text: wire.text,
    score: wire.score,
    retriever: RETRIEVER_FROM_WIRE[wire.source],
    vector_rank: wire.semantic_rank,
    keyword_rank: wire.keyword_rank,
  };
}

/** The exact sentence the backend uses to refuse, from either refusal path. */
export const NO_ANSWER_TEXT = "I cannot answer this question based on the available documents.";

export type AskEvent =
  { type: "token"; text: string } | { type: "done"; sources: Source[]; mode: RetrievalMode | null };

export interface AskOptions {
  documentIds?: string[] | null;
  topK?: number;
  mode?: RetrievalMode;
  signal?: AbortSignal;
}

/**
 * Read an SSE body, yielding one parsed frame per `data:` line.
 *
 * Deliberately hand-rolled rather than using EventSource: EventSource is
 * GET-only, and `/query` needs a POST body. This implements only the
 * subset of the SSE grammar the backend emits -- `data:` lines, events
 * separated by a blank line -- and ignores comments and other fields.
 *
 * The buffering matters: a network chunk boundary can fall anywhere,
 * including mid-JSON, so frames are only dispatched on a complete
 * `\n\n` terminator rather than per chunk.
 */
async function* readSseFrames(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<QueryStreamFrame, void> {
  if (!response.body) {
    throw new ApiError(response.status, "Streaming is not supported in this environment");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data:")) {
            yield JSON.parse(line.slice("data:".length).trim()) as QueryStreamFrame;
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releasing the lock lets `cancel()` tear down the connection when a
    // caller abandons the generator; without it an aborted question keeps
    // the backend generating (and billing) into a stream nobody reads.
    reader.releaseLock();
    if (signal?.aborted !== true) {
      await response.body.cancel().catch(() => undefined);
    }
  }
}

/**
 * Ask a question, yielding answer tokens as they arrive and then the sources.
 *
 * Consumes the `text/event-stream` body of `POST /api/v1/query`: zero or
 * more `token` frames in generation order, then one terminal frame. A
 * `done` frame is yielded through as the final `AskEvent`; an `error`
 * frame is *thrown* as an ApiError, so a failed generation cannot be
 * mistaken for a complete answer by a caller that only accumulates
 * tokens. Note the error arrives inside a 200 -- by the time generation
 * fails the status line is long gone -- so the HTTP status alone never
 * tells you the answer succeeded.
 *
 * Abandoning this generator (`break`, or an aborted `options.signal`)
 * cancels the response body, which drops the connection and stops
 * generation server-side.
 *
 * Retrieval returning nothing is *not* an error: the stream carries
 * `NO_ANSWER_TEXT` as its only token and a `done` frame with no sources
 * and a null mode. Claude is also told to reply with that same sentence
 * when the retrieved chunks turn out to be irrelevant, so treat the
 * string as "no answer" whether or not sources are present.
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

  const response = await fetch(endpoint("/query"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  // Retrieval runs before the stream opens, so its failures still arrive
  // as ordinary status codes and are worth surfacing as such.
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }

  for await (const frame of readSseFrames(response, options.signal)) {
    switch (frame.type) {
      case "token":
        yield { type: "token", text: frame.text };
        break;
      case "done":
        yield {
          type: "done",
          sources: frame.sources.map(toSource),
          mode: frame.retrieval_mode,
        };
        return;
      case "error":
        throw new ApiError(502, frame.message);
    }
  }
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
