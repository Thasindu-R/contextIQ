// Typed REST client to the backend API.
// Single responsibility: HTTP calls only, no UI or state logic. Every
// network call in the app goes through this module.

import { apiUrl } from "@/config";
import type {
  AnswerResponse,
  CitationOut,
  DocumentOut,
  QueryRequest,
  RetrievalMode,
  RetrievedChunkOut,
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

export async function uploadDocument(_files: File[]): Promise<DocumentOut[]> {
  // TODO: POST endpoint("/documents") as multipart/form-data. The field
  // name is `files` (plural, repeatable) and the response is an array
  // even for a single file.
  throw new Error("Not implemented");
}

/** Documents, newest first. No pagination on this route. */
export async function listDocuments(signal?: AbortSignal): Promise<DocumentOut[]> {
  return requestJson<DocumentOut[]>("/documents", { signal });
}

export async function deleteDocument(_documentId: string): Promise<void> {
  // TODO: DELETE endpoint(`/documents/${documentId}`) -- 204, and also
  // 204 for an unknown id.
  throw new Error("Not implemented");
}

export async function submitQuery(
  request: QueryRequest,
  signal?: AbortSignal,
): Promise<AnswerResponse> {
  // A "no context" result comes back as a 200 with empty citations and a
  // null retrieval_mode -- a completed answer, not an error.
  return requestJson<AnswerResponse>("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
}

/**
 * One frame of an answer stream.
 *
 * `token` frames carry a fragment of the answer text and arrive in order;
 * a single terminal `done` frame carries what is only known once
 * generation has finished. An error frame is deliberately absent from
 * this union -- {@link askQuestion} raises it rather than yielding it.
 */
export type AnswerStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      sources: CitationOut[];
      retrieved_chunks: RetrievedChunkOut[];
      /** Null when retrieval found nothing (the FR-10 refusal). */
      retrieval_mode: RetrievalMode | null;
    };

/**
 * Ask a question and consume the answer as a stream of frames.
 *
 * The backend has no SSE endpoint yet, so this makes the one blocking
 * `POST /query` call and synthesises the frames from it: the whole answer
 * arrives as a single `token` frame, then `done`. Consumers must not
 * depend on that -- render each token as it arrives, and swapping this
 * function's body for a real event-stream reader turns the UI
 * incremental with no changes upstream.
 *
 * Throws {@link ApiError} on failure, which is what an `error` frame will
 * do once the stream is real: today a Claude generation failure is a 502,
 * later it may be an error frame inside a 200, and either way the caller
 * sees a throw instead of a `done` frame.
 */
export async function* askQuestion(
  request: QueryRequest,
  signal?: AbortSignal,
): AsyncGenerator<AnswerStreamEvent, void, undefined> {
  const response = await submitQuery(request, signal);

  yield { type: "token", text: response.answer };
  yield {
    type: "done",
    sources: response.citations,
    retrieved_chunks: response.retrieved_chunks,
    retrieval_mode: response.retrieval_mode,
  };
}
