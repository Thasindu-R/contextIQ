// useDocuments: loads the document library from the API.
// Single responsibility: fetch and expose the document list so
// components never touch api/client directly. No rendering logic.

import { useCallback, useEffect, useState } from "react";

import { listDocuments } from "@/api/client";
import { useToast } from "@/hooks/useToast";
import type { DocumentOut } from "@/types";

export interface UseDocumentsResult {
  documents: DocumentOut[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDocuments(): UseDocumentsResult {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const detail = cause instanceof Error ? cause.message : "Could not load documents.";
        setError(detail);
        // Toasted as well as recorded: the inline copy only shows inside
        // the document filter's popover, which the reader may never open.
        showToast({
          tone: "error",
          title: "Could not load documents",
          description: detail,
        });
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

  return { documents, isLoading, error, reload };
}
