// useDocuments: owns the document library's state (FR-1, FR-11).
// Single responsibility: fetch/upload/delete documents and poll while any
// are still ingesting. No rendering — components consume what this returns.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type Document,
  type DocumentStatus,
} from "@/api/client";

/** How often to re-check documents that aren't `ready` yet. */
const POLL_INTERVAL_MS = 3000;

/** Mirrors the backend's `max_upload_size_mb` default. Checked here so an
 *  oversized file fails instantly instead of after a long upload + 413. */
const MAX_UPLOAD_MB = 20;

/** The only two types the backend will ingest; anything else is a 415. */
const ACCEPTED_TYPES = ["application/pdf", "text/plain"];
export const ACCEPT_ATTRIBUTE = ".pdf,.txt";

/** Statuses that will never change on their own — nothing left to poll for. */
const TERMINAL_STATUSES: DocumentStatus[] = ["ready", "error"];

export interface LibraryDocument extends Document {
  /** True for a row that exists only in the browser: the upload is still
   *  in flight and the server has never heard of this document. It has a
   *  client-generated id and is replaced by the real row on success. */
  isOptimistic?: boolean;
}

interface UseDocumentsResult {
  documents: LibraryDocument[];
  /** Only true for the very first load — a poll or refresh must not blank
   *  the grid back to skeletons. */
  isLoading: boolean;
  error: string | null;
  dismissError: () => void;
  upload: (files: File[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function useDocuments(): UseDocumentsResult {
  const [serverDocuments, setServerDocuments] = useState<LibraryDocument[]>([]);
  const [optimistic, setOptimistic] = useState<LibraryDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the poll effect doesn't re-subscribe on every render.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const documents = await listDocuments();
      if (isMounted.current) {
        setServerDocuments(documents);
      }
    } catch (cause) {
      if (isMounted.current) {
        setError(messageOf(cause));
      }
    }
  }, []);

  // The initial load is spelled out rather than calling refresh(), so every
  // state write happens after an await -- a synchronous setState in an
  // effect body triggers a cascading render (and react-hooks flags it).
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const documents = await listDocuments();
        if (!cancelled) {
          setServerDocuments(documents);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(messageOf(cause));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll only while something is actually still ingesting, and tear the
  // interval down both when that stops being true and on unmount.
  //
  // NOTE: this is currently near-dead code, and deliberately so. Ingestion
  // is synchronous server-side — the upload response doesn't return until
  // the document is `ready`, and a failure is a 4xx that persists no row —
  // so the list realistically never contains a non-terminal document. The
  // loop exists because it's the piece that has to already be here the day
  // ingestion moves to a background task.
  const hasWorkInProgress = serverDocuments.some(
    (document) => !TERMINAL_STATUSES.includes(document.status),
  );

  useEffect(() => {
    if (!hasWorkInProgress) {
      return;
    }
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasWorkInProgress, refresh]);

  const upload = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) {
        return;
      }

      const rejected = files.filter(
        (file) => !ACCEPTED_TYPES.includes(file.type) || file.size > MAX_UPLOAD_MB * 1024 * 1024,
      );
      const accepted = files.filter((file) => !rejected.includes(file));

      if (rejected.length > 0) {
        setError(
          `Skipped ${rejected.map((f) => f.name).join(", ")} — only PDF and text files ` +
            `under ${MAX_UPLOAD_MB}MB can be ingested.`,
        );
      }
      if (accepted.length === 0) {
        return;
      }

      // Optimistic rows render immediately: ingestion runs inside the
      // request, so a large PDF is a multi-second wait with nothing else
      // to show for it.
      const placeholders: LibraryDocument[] = accepted.map((file) => ({
        id: `optimistic-${crypto.randomUUID()}`,
        filename: file.name,
        upload_time: new Date().toISOString(),
        status: "queued",
        page_count: null,
        isOptimistic: true,
      }));
      setOptimistic((current) => [...placeholders, ...current]);

      const clearPlaceholder = (id: string) =>
        setOptimistic((current) => current.filter((document) => document.id !== id));

      // Sequential, not parallel: each upload is its own transaction
      // server-side, and serialising keeps one failure from obscuring
      // which of several concurrent uploads actually failed.
      for (const [index, file] of accepted.entries()) {
        const placeholderId = placeholders[index].id;
        try {
          await uploadDocument(file);
          clearPlaceholder(placeholderId);
        } catch (cause) {
          clearPlaceholder(placeholderId);
          if (isMounted.current) {
            setError(`${file.name}: ${messageOf(cause)}`);
          }
          break;
        }
      }

      // Always re-fetch, including after a failure: an upload error tells
      // the client nothing about which earlier files were committed, so
      // local state can't be trusted from here.
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      // Drop it locally first so the grid responds immediately; the
      // refresh below is what makes it true.
      setServerDocuments((current) => current.filter((document) => document.id !== id));
      try {
        await deleteDocument(id);
      } catch (cause) {
        setError(messageOf(cause));
      }
      await refresh();
    },
    [refresh],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    documents: [...optimistic, ...serverDocuments],
    isLoading,
    error,
    dismissError,
    upload,
    remove,
  };
}
