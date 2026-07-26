// DocumentList: view and delete uploaded documents (FR-11).
// Single responsibility: presentational rendering of the document list.
// Loading, deleting and errors are the caller's state.

import CitationBadge from "@/components/CitationBadge";
import StatusPill from "@/components/StatusPill";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import IconButton from "@/components/ui/IconButton";
import Skeleton from "@/components/ui/Skeleton";
import type { DocumentOut } from "@/types";

interface DocumentListProps {
  documents: DocumentOut[];
  isLoading: boolean;
  error: string | null;
  onDelete: (documentId: string) => void;
  /** Id currently being deleted, if any. */
  deletingId: string | null;
}

/** Locale-formatted upload time, degrading to the raw ISO string rather
 *  than throwing if the backend ever sends something unparseable. */
function formatUploadTime(isoTime: string): string {
  const parsed = new Date(isoTime);
  if (Number.isNaN(parsed.getTime())) return isoTime;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LoadingRows(): JSX.Element {
  return (
    <div className="space-y-2" role="status" aria-label="Loading documents">
      {[0, 1, 2].map((row) => (
        <Card key={row} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-2.5 w-32" />
          </div>
          <Skeleton className="h-4 w-14 rounded-full" />
        </Card>
      ))}
    </div>
  );
}

export default function DocumentList({
  documents,
  isLoading,
  error,
  onDelete,
  deletingId,
}: DocumentListProps): JSX.Element {
  if (isLoading) return <LoadingRows />;

  if (error !== null) {
    return <EmptyState title="Could not load documents" description={error} />;
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        title="No documents yet"
        description="Upload a PDF or text file above, then ask a question about it."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {documents.map((document) => (
        <Card as="li" key={document.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <CitationBadge document={document.filename} page={null} />
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatUploadTime(document.upload_time)}
              {document.page_count !== null
                ? ` · ${document.page_count} ${document.page_count === 1 ? "page" : "pages"}`
                : ""}
            </p>
          </div>

          <StatusPill status={document.status} />

          <IconButton
            label={`Delete ${document.filename}`}
            onClick={() => onDelete(document.id)}
            disabled={deletingId === document.id}
            className="hover:text-red-600 dark:hover:text-red-400"
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ✕
            </span>
          </IconButton>
        </Card>
      ))}
    </ul>
  );
}
