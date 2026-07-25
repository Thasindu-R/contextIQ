// Typed REST client to the backend API.
// Single responsibility: HTTP calls only, no UI or state logic. Every
// network call in the app goes through this module.

import { apiUrl } from "@/config";
import type { AnswerResponse, DocumentOut, QueryRequest } from "@/types";

/** Every route is mounted under this prefix -- health probes included. */
const API_PREFIX = "/api/v1";

export function endpoint(path: string): string {
  return apiUrl(`${API_PREFIX}${path}`);
}

export async function uploadDocument(_files: File[]): Promise<DocumentOut[]> {
  // TODO: POST endpoint("/documents") as multipart/form-data. The field
  // name is `files` (plural, repeatable) and the response is an array
  // even for a single file.
  throw new Error("Not implemented");
}

export async function listDocuments(): Promise<DocumentOut[]> {
  // TODO: GET endpoint("/documents") -- returns newest first.
  throw new Error("Not implemented");
}

export async function deleteDocument(_documentId: string): Promise<void> {
  // TODO: DELETE endpoint(`/documents/${documentId}`) -- 204, and also
  // 204 for an unknown id.
  throw new Error("Not implemented");
}

export async function submitQuery(_request: QueryRequest): Promise<AnswerResponse> {
  // TODO: POST endpoint("/query"). Note a "no context" result comes back
  // as a 200 with empty citations and a null retrieval_mode.
  throw new Error("Not implemented");
}
