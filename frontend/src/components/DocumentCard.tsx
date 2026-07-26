// DocumentCard: one document in the library grid (FR-11).
// Single responsibility: presentational card + action buttons. Delete is
// raised to the parent; nothing here talks to the API.

import StatusPill from "@/components/StatusPill";
import type { LibraryDocument } from "@/hooks/useDocuments";

interface DocumentCardProps {
  document: LibraryDocument;
  onDelete: (id: string) => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatUploadedAt(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "Unknown date" : DATE_FORMAT.format(parsed);
}

export default function DocumentCard({ document, onDelete }: DocumentCardProps): JSX.Element {
  const isOptimistic = document.isOptimistic === true;

  function handleDelete(): void {
    // Deletion cascades to the document's chunks and is not undoable, so
    // it's worth one interruption. Note the API returns 204 for an unknown
    // id too, so a "success" here never proves the row existed.
    const confirmed = window.confirm(
      `Delete "${document.filename}"? Its chunks are removed too, and answers ` +
        `will no longer cite it.`,
    );
    if (confirmed) {
      onDelete(document.id);
    }
  }

  return (
    <li className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3
            title={document.filename}
            className="truncate text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            {document.filename}
          </h3>
          <StatusPill status={document.status} />
        </div>

        <dl className="text-xs text-slate-500 dark:text-slate-400">
          <div className="flex gap-1.5">
            <dt className="sr-only">Pages</dt>
            <dd>{document.page_count === null ? "— pages" : `${document.page_count} pages`}</dd>
            <span aria-hidden="true">·</span>
            <dt className="sr-only">Uploaded</dt>
            <dd>{formatUploadedAt(document.upload_time)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center gap-2">
        {/* Re-index has no endpoint to call: there is no
            POST /documents/{id}/reindex, and re-uploading isn't possible
            either because the original file can't be read back (no
            document download route). Shown disabled rather than omitted so
            the gap is visible instead of quietly missing. */}
        <button
          type="button"
          disabled
          title="Re-indexing needs a backend endpoint that doesn't exist yet"
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 disabled:cursor-not-allowed dark:text-slate-600"
        >
          Re-index
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={isOptimistic}
          title={isOptimistic ? "Still uploading" : undefined}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent dark:text-red-400 dark:disabled:text-slate-600"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
