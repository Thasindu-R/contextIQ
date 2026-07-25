// Typed REST client for the ContextIQ backend.
// Single responsibility: HTTP calls and wire<->domain mapping. No UI, no
// React, no state. Every network call in the app goes through this module.
//
// Wire shapes (snake_case) live in @/types and mirror the backend's
// Pydantic schemas verbatim; this module re-exports them and adds the one
// derived shape the UI actually wants (Source, below).

import { config } from "@/config";
import type { AnswerResponse, DocumentOut, RetrievalMode, RetrievalSource } from "@/types";

export type { DocumentStatus, RetrievalMode, RetrievalSource } from "@/types";
export type { AnswerResponse, CitationOut, RetrievedChunkOut } from "@/types";

/**
 * An uploaded document.
 *
 * Named ContextDocument rather than Document so it can't shadow lib.dom's
 * global `Document` type in modules that import it.
 */
export type ContextDocument = DocumentOut;

/**
 * A retrieved chunk joined with its citation — what a UI needs to show
 * "where did this answer come from".
 *
 * This is a derived shape, not a wire shape, hence camelCase. The join is
 * necessary because the two halves live in different arrays: only
 * `citations` carries the document's filename, and only `retrieved_chunks`
 * carries the score and retrieval provenance.
 */
export interface Source {
  chunkId: string;
  documentId: string;
  /** Filename, from the citation half of the response. */
  documentName: string;
  page: number | null;
  /**
   * Comparable only within a single retrieval mode: cosine distance for
   * semantic (lower is better), ts_rank_cd for keyword and the RRF fused
   * score for hybrid (higher is better). Sources arrive pre-ranked, so
   * render them in order rather than re-sorting on this.
   */
  score: number;
  /** Which leg surfaced this chunk. "both" means it placed in the semantic
   *  and keyword legs of a hybrid search — what RRF rewards. */
  retriever: RetrievalSource;
  /** 1-based position within that leg, or null if it didn't place there. */
  semanticRank: number | null;
  keywordRank: number | null;
  /** Chunk text truncated to ~300 chars by the server. */
  snippet: string;
  /** Full chunk text, untruncated. */
  text: string;
}

export interface AskOptions {
  mode?: RetrievalMode;
  topK?: number;
  signal?: AbortSignal;
}

/** Streamed output of askQuestion. */
export type AskEvent =
  | { type: "token"; token: string }
  | {
      type: "done";
      answer: string;
      sources: Source[];
      retrievalMode: RetrievalMode | null;
    };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown for any non-2xx response. `message` is the server's own text
 *  where it sent one, so it is safe to surface directly in the UI. */
export class ApiError extends Error {
  readonly status: number;
  /** The server's `detail` field, or null when it sent none. */
  readonly detail: string | null;

  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    // Required for `instanceof` to survive the ES5 target's class-extends
    // downleveling.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * FastAPI sends `detail` as a string for handled domain errors, but as an
 * array of `{loc, msg, type}` objects for request-validation failures — and
 * this API returns 422 for both, so both have to be understood.
 */
function normaliseDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail || null;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) =>
        entry && typeof entry === "object" && "msg" in entry
          ? String((entry as { msg: unknown }).msg)
          : null,
      )
      .filter((msg): msg is string => Boolean(msg));
    return messages.length > 0 ? messages.join("; ") : null;
  }
  return null;
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `${response.status} ${response.statusText}`.trim();

  let body = "";
  try {
    body = await response.text();
  } catch {
    return new ApiError(response.status, fallback);
  }

  if (!body) {
    return new ApiError(response.status, fallback);
  }

  try {
    const parsed: unknown = JSON.parse(body);
    const detail =
      parsed && typeof parsed === "object"
        ? normaliseDetail((parsed as { detail?: unknown }).detail)
        : null;
    return new ApiError(response.status, detail ?? fallback, detail);
  } catch {
    // Not JSON at all — a proxy or gateway error page, most likely. Keep a
    // bounded prefix so the UI shows something useful instead of a blank
    // error, without dumping a whole HTML document into a toast.
    return new ApiError(response.status, body.slice(0, 200).trim() || fallback);
  }
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

/** Every backend route is mounted under this prefix. */
const API_PREFIX = "/api/v1";

/** Absolute (or proxy-relative) URL for an API path. */
export function apiUrl(path: string): string {
  return `${config.apiBaseUrl}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  // Content-Type is deliberately not set for FormData: the browser has to
  // set it itself so it can include the multipart boundary.
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(apiUrl(path), { ...init, headers });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Upload a single document and wait for it to be ingested.
 *
 * Ingestion is synchronous server-side, so this resolves only once the file
 * has been extracted, chunked, embedded and stored — expect it to be slow
 * for large PDFs, and expect `status` to already be "ready".
 *
 * The endpoint accepts a repeated `files` field and always answers with an
 * array; this sends one and unwraps it.
 */
export async function uploadDocument(file: File): Promise<ContextDocument> {
  const form = new FormData();
  form.append("files", file);

  const uploaded = await request<ContextDocument[]>("/documents", {
    method: "POST",
    body: form,
  });

  const document = uploaded[0];
  if (!document) {
    throw new ApiError(502, "Upload succeeded but the server returned no document");
  }
  return document;
}

/** All documents, newest first. */
export function listDocuments(): Promise<ContextDocument[]> {
  return request<ContextDocument[]>("/documents");
}

/**
 * Delete a document and its chunks.
 *
 * Idempotent server-side: deleting an id that never existed also succeeds,
 * so a resolved promise does not prove anything was there.
 */
export async function deleteDocument(id: string): Promise<void> {
  await request<void>(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Fetch one document by id.
 *
 * There is no `GET /documents/{id}` route on the backend, so this filters
 * the list. Fine at the current scale; swap it for a direct call if that
 * endpoint ever lands.
 */
export async function getDocument(id: string): Promise<ContextDocument> {
  const documents = await listDocuments();
  const match = documents.find((document) => document.id === id);
  if (!match) {
    throw new ApiError(404, `No document with id ${id}`);
  }
  return match;
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

function toSources(answer: AnswerResponse): Source[] {
  const citationsByChunk = new Map(
    answer.citations.map((citation) => [citation.chunk_id, citation]),
  );

  return answer.retrieved_chunks.map((chunk) => {
    const citation = citationsByChunk.get(chunk.chunk_id);
    return {
      chunkId: chunk.chunk_id,
      documentId: chunk.document_id,
      documentName: citation?.document ?? "",
      page: chunk.page,
      score: chunk.score,
      retriever: chunk.source,
      semanticRank: chunk.semantic_rank,
      keywordRank: chunk.keyword_rank,
      snippet: citation?.snippet ?? "",
      text: chunk.text,
    };
  });
}

/**
 * Split an SSE byte stream into `event:`/`data:` frames.
 *
 * Frames are separated by a blank line and can be split across arbitrary
 * chunk boundaries, so the tail of each read has to be carried over.
 */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length > 0) {
          yield { event, data: dataLines.join("\n") };
        }

        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Ask a question and stream the grounded answer.
 *
 * Yields `{type: "token"}` as the answer arrives and exactly one final
 * `{type: "done"}` carrying the joined sources.
 *
 * IMPORTANT: the backend does not stream today — `POST /query` returns one
 * JSON body once retrieval and generation have both finished. This asks for
 * `text/event-stream` and parses it when offered, but otherwise falls back
 * to that single response and emits the whole answer as one token. The
 * consumer-side shape is identical either way, so UI written against this
 * will not need to change when real streaming lands.
 *
 * A question with nothing to retrieve from is not an error: the server
 * answers 200 with an explicit refusal, no sources, and a null
 * retrievalMode.
 */
export async function* askQuestion(
  question: string,
  documentIds?: string[],
  options: AskOptions = {},
): AsyncGenerator<AskEvent, void, void> {
  const response = await send("/query", {
    method: "POST",
    signal: options.signal,
    headers: { Accept: "text/event-stream, application/json" },
    body: JSON.stringify({
      question,
      document_ids: documentIds ?? null,
      ...(options.topK === undefined ? {} : { top_k: options.topK }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    }),
  });

  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream") && response.body) {
    let answer = "";
    for await (const frame of readEventStream(response.body)) {
      if (frame.data === "[DONE]") {
        break;
      }
      const payload: unknown = JSON.parse(frame.data);

      if (frame.event === "token") {
        const token = String((payload as { token?: unknown }).token ?? "");
        answer += token;
        yield { type: "token", token };
      } else if (frame.event === "done") {
        const final = payload as AnswerResponse;
        yield {
          type: "done",
          answer: final.answer || answer,
          sources: toSources(final),
          retrievalMode: final.retrieval_mode,
        };
        return;
      }
    }
    // Stream ended without a `done` frame — still report what we have
    // rather than leaving the caller hanging.
    yield { type: "done", answer, sources: [], retrievalMode: options.mode ?? null };
    return;
  }

  const final = (await response.json()) as AnswerResponse;
  if (final.answer) {
    yield { type: "token", token: final.answer };
  }
  yield {
    type: "done",
    answer: final.answer,
    sources: toSources(final),
    retrievalMode: final.retrieval_mode,
  };
}
