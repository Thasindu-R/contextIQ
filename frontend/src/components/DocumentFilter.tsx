// DocumentFilter: scopes a question to a subset of documents (FR-6).
// Single responsibility: presentational multi-select over the ready
// documents. It owns only whether its popover is open.

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { FOCUS_RING_TIGHT } from "@/components/ui/focusRing";
import Skeleton from "@/components/ui/Skeleton";
import type { DocumentOut } from "@/types";

interface DocumentFilterProps {
  /** Selectable documents -- only ones that finished ingesting. */
  documents: DocumentOut[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  isLoading: boolean;
  error: string | null;
  disabled?: boolean;
}

/** An empty selection means "search everything", not "search nothing". */
function summarise(documents: DocumentOut[], selectedIds: string[]): string {
  if (selectedIds.length === 0) return "All documents";
  if (selectedIds.length === 1) {
    const only = documents.find((document) => document.id === selectedIds[0]);
    return only?.filename ?? "1 document";
  }
  return `${selectedIds.length} documents`;
}

function LoadingRows(): JSX.Element {
  return (
    <div className="space-y-2 p-2" aria-label="Loading documents" role="status">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-2.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <Skeleton className={`h-3 ${row === 1 ? "w-28" : "w-40"}`} />
        </div>
      ))}
    </div>
  );
}

export default function DocumentFilter({
  documents,
  selectedIds,
  onChange,
  isLoading,
  error,
  disabled = false,
}: DocumentFilterProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  // Escape closes from anywhere, not just when focus happens to be inside
  // the popover -- the pointer is often nowhere near it.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function toggle(documentId: string): void {
    onChange(
      selectedIds.includes(documentId)
        ? selectedIds.filter((id) => id !== documentId)
        : [...selectedIds, documentId],
    );
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="flex max-w-[12rem] items-center gap-1.5 py-1.5 sm:max-w-xs"
      >
        <span className="truncate">{summarise(documents, selectedIds)}</span>
        <span aria-hidden="true" className="text-slate-400">
          ▾
        </span>
      </Button>

      {isOpen ? (
        <>
          {/* Click-away layer: cheaper and more reliable than tracking
              document-level pointer events for a popover this small. */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Filter documents"
            className="absolute bottom-full z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {isLoading ? <LoadingRows /> : null}

            {error !== null && !isLoading ? (
              <p className="px-2 py-3 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            {!isLoading && error === null && documents.length === 0 ? (
              <EmptyState
                title="No documents ready"
                description="Upload one from the Library to scope a question to it."
              />
            ) : null}

            {!isLoading
              ? documents.map((document) => (
                  <label
                    key={document.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(document.id)}
                      onChange={() => toggle(document.id)}
                      // accent-color, not text-color: without the forms
                      // plugin a native checkbox ignores `text-*`, and
                      // accent-primary tints the check in both themes.
                      className={`h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-primary dark:border-slate-600 dark:bg-slate-900 ${FOCUS_RING_TIGHT}`}
                    />
                    <span className="truncate">{document.filename}</span>
                  </label>
                ))
              : null}

            {selectedIds.length > 0 ? (
              <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-700">
                <Button
                  variant="ghost"
                  onClick={() => onChange([])}
                  className="w-full text-left text-primary hover:text-primary-hover dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  Search all documents
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
