// Typed REST client to the backend API.
// Single responsibility: HTTP calls only, no UI or state logic.

import type { AnswerResponse, DocumentOut, QueryRequest } from "../types";

export async function uploadDocument(_file: File): Promise<DocumentOut> {
  // TODO: POST /api/v1/documents (multipart/form-data)
  throw new Error("Not implemented");
}

export async function listDocuments(): Promise<DocumentOut[]> {
  // TODO: GET /api/v1/documents
  throw new Error("Not implemented");
}

export async function deleteDocument(_documentId: string): Promise<void> {
  // TODO: DELETE /api/v1/documents/{documentId}
  throw new Error("Not implemented");
}

export async function submitQuery(_request: QueryRequest): Promise<AnswerResponse> {
  // TODO: POST /api/v1/query
  throw new Error("Not implemented");
}
