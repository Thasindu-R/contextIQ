// DocumentFilter: scopes a question to a subset of documents (FR-6).
// Single responsibility: presentational multi-select over the ready
// documents. It owns only whether its popover is open.

import { useState } from "react";

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

export default function DocumentFilter({
  documents,
  selectedIds,
  onChange,
  isLoading,
  error,
  disabled = false,
}: DocumentFilterProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  function toggle(documentId: string): void {
    onChange(
      selectedIds.includes(documentId)
        ? selectedIds.filter((id) => id !== documentId)
        : [...selectedIds, documentId],
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex max-w-xs items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span className="truncate">{summarise(documents, selectedIds)}</span>
        <span aria-hidden="true" className="text-slate-400">
          ▾
        </span>
      </button>

      {isOpen ? (
        <>
          {/* Click-away layer: cheaper and more reliable than tracking
              document-level pointer events for a popover this small. */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            className="absolute bottom-full z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsOpen(false);
            }}
          >
            {isLoading ? (
              <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
                Loading documents...
              </p>
            ) : null}

            {error !== null && !isLoading ? (
              <p className="px-2 py-3 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            {!isLoading && error === null && documents.length === 0 ? (
              <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
                No documents are ready yet. Upload one from the Library.
              </p>
            ) : null}

            {documents.map((document) => (
              <label
                key={document.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(document.id)}
                  onChange={() => toggle(document.id)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-900"
                />
                <span className="truncate">{document.filename}</span>
              </label>
            ))}

            {selectedIds.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full rounded-lg border-t border-slate-100 px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:hover:bg-slate-700"
              >
                Search all documents
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
