// Shared frontend types mirroring backend Pydantic schemas.
// Single responsibility: type definitions only, no logic.

export type RetrievalMode = "semantic" | "keyword" | "hybrid";

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface DocumentOut {
  // TODO: id: string; filename: string; mimeType: string;
  // uploadDate: string; status: DocumentStatus; pageCount?: number
}

export interface CitationOut {
  // TODO: documentId: string; filename: string; page?: number; chunkId: string
}

export interface RetrievedChunkOut {
  // TODO: chunkId: string; documentId: string; text: string;
  // page?: number; score: number; source: "semantic" | "keyword" | "fused"
}

export interface QueryRequest {
  // TODO: question: string; documentIds?: string[]; retrievalMode: RetrievalMode
}

export interface AnswerResponse {
  // TODO: answer: string; citations: CitationOut[];
  // retrievedChunks: RetrievedChunkOut[]; retrievalMode: RetrievalMode
}
