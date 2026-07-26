// DocumentsPage: the library route (FR-1, FR-11).
// Single responsibility: page-level composition — wires useDocuments to
// UploadZone / DocumentList / Toast. No logic of its own.

import DocumentList from "@/components/DocumentList";
import Toast from "@/components/Toast";
import UploadZone from "@/components/UploadZone";
import { ACCEPT_ATTRIBUTE, useDocuments } from "@/hooks/useDocuments";

export default function DocumentsPage(): JSX.Element {
  const { documents, isLoading, error, dismissError, upload, remove } = useDocuments();

  const isUploading = documents.some((document) => document.isOptimistic === true);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Upload PDFs and text files, and manage the documents available to answer questions.
      </p>

      <div className="mt-8">
        <UploadZone
          onFiles={(files) => void upload(files)}
          accept={ACCEPT_ATTRIBUTE}
          disabled={isUploading}
        />
        {isUploading && (
          // Necessarily indeterminate: ingestion is synchronous and there is
          // no progress endpoint, so extract -> chunk -> embed -> persist all
          // happen before the upload request returns.
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Ingesting — extracting text, chunking and embedding. This can take a while for a large
            PDF.
          </p>
        )}
      </div>

      <div className="mt-8">
        <DocumentList
          documents={documents}
          isLoading={isLoading}
          onDelete={(id) => void remove(id)}
        />
      </div>

      {error !== null && <Toast message={error} onDismiss={dismissError} />}
    </div>
  );
}
