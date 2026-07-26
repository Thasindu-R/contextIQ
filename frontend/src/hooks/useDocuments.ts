// useDocuments: owns the document library (FR-1, FR-11).
// Single responsibility: load, upload and delete documents so components
// never touch api/client directly. No rendering logic.

import { useCallback, useEffect, useState } from "react";

import { deleteDocument, listDocuments, uploadDocument } from "@/api/client";
import { useToast } from "@/hooks/useToast";
import type { DocumentOut } from "@/types";

export interface UseDocumentsResult {
  documents: DocumentOut[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  /** Resolves once the (synchronous) ingestion has finished. */
  upload: (files: File[]) => Promise<void>;
  isUploading: boolean;
  remove: (documentId: string) => Promise<void>;
  /** Id currently being deleted, so its row can show the pending state. */
  deletingId: string | null;
}

function describe(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function useDocuments(): UseDocumentsResult {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Bumped to re-run the fetch; the effect owns the request so it can
  // abort cleanly, and nothing in its body updates state synchronously.
  const [reloadToken, setReloadToken] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    const controller = new AbortController();

    listDocuments(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setDocuments(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const detail = describe(cause, "Could not load documents.");
        setError(detail);
        // Toasted as well as recorded: the inline copy only shows inside
        // the document filter's popover, which may never be opened.
        showToast({ tone: "error", title: "Could not load documents", description: detail });
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [reloadToken, showToast]);

  const reload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setIsUploading(true);
      try {
        await uploadDocument(files);
      } catch (cause: unknown) {
        showToast({
          tone: "error",
          title: "Upload failed",
          description: describe(cause, "The document could not be ingested."),
        });
      } finally {
        setIsUploading(false);
        // Reload on success *and* failure: a batch is ingested one file at
        // a time, so a mid-batch error leaves earlier files committed and
        // returns no list of what made it. Local state can't be trusted.
        reload();
      }
    },
    [reload, showToast],
  );

  const remove = useCallback(
    async (documentId: string) => {
      setDeletingId(documentId);
      try {
        await deleteDocument(documentId);
      } catch (cause: unknown) {
        showToast({
          tone: "error",
          title: "Could not delete the document",
          description: describe(cause, "The document was not deleted."),
        });
      } finally {
        setDeletingId(null);
        reload();
      }
    },
    [reload, showToast],
  );

  return { documents, isLoading, error, reload, upload, isUploading, remove, deletingId };
}
