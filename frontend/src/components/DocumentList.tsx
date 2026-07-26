// DocumentList: the responsive grid of uploaded documents (FR-11).
// Single responsibility: choose between loading / empty / populated and
// render the grid. Data comes from the parent; no API access here.

import DocumentCard from "@/components/DocumentCard";
import type { LibraryDocument } from "@/hooks/useDocuments";

interface DocumentListProps {
  documents: LibraryDocument[];
  isLoading: boolean;
  onDelete: (id: string) => void;
}

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

export default function DocumentList({
  documents,
  isLoading,
  onDelete,
}: DocumentListProps): JSX.Element {
  if (isLoading) {
    return (
      <ul className={GRID} aria-busy="true" aria-label="Loading documents">
        {[0, 1, 2].map((key) => (
          <DocumentCardSkeleton key={key} />
        ))}
      </ul>
    );
  }

  if (documents.length === 0) {
    return <EmptyState />;
  }

  return (
    <ul className={GRID}>
      {documents.map((document) => (
        <DocumentCard key={document.id} document={document} onDelete={onDelete} />
      ))}
    </ul>
  );
}

function DocumentCardSkeleton(): JSX.Element {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="animate-pulse space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-6 w-24 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    </li>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Upload a document to get started
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Questions are answered only from documents in this library, with citations back to them.
      </p>
    </div>
  );
}
