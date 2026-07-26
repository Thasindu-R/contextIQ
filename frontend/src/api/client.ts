// Typed REST client to the backend API.
// Single responsibility: HTTP calls only, no UI or state logic. Every
// network call in the app goes through this module.

import { apiUrl } from "@/config";
import type {
  DocumentOut,
  QueryRequest,
  QueryStreamFrame,
  RetrievalMode,
  SourceOut,
} from "@/types";

/** Every route is mounted under this prefix -- health probes included. */
const API_PREFIX = "/api/v1";

export function endpoint(path: string): string {
  return apiUrl(`${API_PREFIX}${path}`);
}

/**
 * A non-2xx response, carrying the backend's `detail` string as its
 * message so callers can surface it verbatim (all handled errors return
 * `{"detail": "..."}`).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Pull `detail` off an error body, falling back to the status line. */
async function toApiError(response: Response): Promise<ApiError> {
  let detail = `Request failed with status ${response.status}`;
  try {
    const body: unknown = await response.json();
    const parsed = body as { detail?: unknown } | null;
    if (parsed && typeof parsed.detail === "string") {
      detail = parsed.detail;
    }
  } catch {
    // Body was empty or not JSON -- the status-derived message stands.
  }
  return new ApiError(response.status, detail);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), init);
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

/**
 * Upload one or more documents.
 *
 * Ingestion is synchronous, so this request does not return until extract
 * → chunk → embed → persist has finished and the documents come back
 * already `ready`. Expect it to be slow for large PDFs.
 *
 * Files are ingested one at a time, each in its own transaction: if the
 * third of five fails, the first two stay committed, the request fails
 * with that file's error, and the last two are never attempted -- and the
 * response body is the error, not a partial list. Callers must re-fetch
 * the document list after a failure rather than trusting local state.
 */
export async function uploadDocument(files: File[]): Promise<DocumentOut[]> {
  const body = new FormData();
  for (const file of files) {
    // The field name is `files`, repeated -- a single field named `file`
    // is a 422 from FastAPI.
    body.append("files", file);
  }
  // No explicit Content-Type: the browser has to set the multipart
  // boundary itself.
  return requestJson<DocumentOut[]>("/documents", { method: "POST", body });
}

/** Documents, newest first. No pagination on this route. */
export async function listDocuments(signal?: AbortSignal): Promise<DocumentOut[]> {
  return requestJson<DocumentOut[]>("/documents", { signal });
}

/**
 * Delete a document and its chunks.
 *
 * Idempotent on the server: an unknown id also returns 204, so a caller
 * cannot distinguish "deleted" from "never existed".
 */
export async function deleteDocument(documentId: string): Promise<void> {
  // 204 with an empty body, so there is nothing to parse.
  const response = await fetch(endpoint(`/documents/${encodeURIComponent(documentId)}`), {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
}

/**
 * One frame of an answer stream, as the UI consumes it.
 *
 * `token` frames carry a fragment of the answer text and arrive in
 * generation order; a single terminal `done` frame carries what is only
 * known once generation has finished. The wire's `error` frame is
 * deliberately absent from this union -- {@link askQuestion} throws it
 * rather than yielding it, so a caller that only accumulates tokens
 * cannot mistake a failed generation for a finished answer.
 */
export type AnswerStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      sources: SourceOut[];
      /** Null when retrieval found nothing (the FR-10 refusal). */
      retrieval_mode: RetrievalMode | null;
    };

/**
 * Read an SSE body, yielding one parsed frame per `data:` line.
 *
 * Hand-rolled rather than using EventSource, which is GET-only while
 * `/query` needs a POST body. Implements only the subset of the SSE
 * grammar the backend emits -- `data:` lines, events separated by a
 * blank line -- and ignores comments and other fields.
 *
 * The buffering matters: a network chunk boundary can fall anywhere,
 * including mid-JSON, so frames are dispatched only on a complete
 * `\n\n` terminator rather than once per chunk.
 */
async function* readSseFrames(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<QueryStreamFrame, void, undefined> {
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
    // Releasing the lock lets cancel() tear down the connection when a
    // caller abandons the generator; without it an abandoned question
    // keeps the backend generating (and billing) into a stream nobody
    // is reading.
    reader.releaseLock();
    if (signal?.aborted !== true) {
      await response.body.cancel().catch(() => undefined);
    }
  }
}

/**
 * Ask a question and consume the answer as a stream of frames.
 *
 * Consumes the `text/event-stream` body of `POST /api/v1/query`: zero or
 * more `token` frames, then exactly one terminal frame. `done` is
 * yielded through; an `error` frame is **thrown** as an {@link ApiError}.
 * Note that an error arrives inside a 200 -- by the time generation
 * fails the status line is long gone -- so the HTTP status alone never
 * proves the answer succeeded.
 *
 * Retrieval runs before the stream opens, so retrieval-side failures
 * still arrive as ordinary status codes and are thrown as such.
 *
 * Empty retrieval is **not** an error: the stream carries the refusal
 * sentence as its only token and a `done` frame with no sources and a
 * null mode. Claude is also instructed to reply with that same sentence
 * when the retrieved chunks turn out to be irrelevant, so treat the
 * string as "no answer" whether or not sources are present.
 */
export async function* askQuestion(
  request: QueryRequest,
  signal?: AbortSignal,
): AsyncGenerator<AnswerStreamEvent, void, undefined> {
  const response = await fetch(endpoint("/query"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  for await (const frame of readSseFrames(response, signal)) {
    switch (frame.type) {
      case "token":
        yield { type: "token", text: frame.text };
        break;
      case "done":
        yield { type: "done", sources: frame.sources, retrieval_mode: frame.retrieval_mode };
        return;
      case "error":
        // 502 is the status the pre-streaming path used for the same
        // failure, kept so UI branching on status stays meaningful.
        throw new ApiError(502, frame.message);
    }
  }
}
