// DocumentsPage: the library route (FR-1, FR-11).
// Single responsibility: page-level composition for managing documents --
// it owns the useDocuments state and passes it to the two components.

import DocumentList from "@/components/DocumentList";
import FileUpload from "@/components/FileUpload";
import { useDocuments } from "@/hooks/useDocuments";

export default function DocumentsPage(): JSX.Element {
  const { documents, isLoading, error, upload, isUploading, remove, deletingId } = useDocuments();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Library</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Upload PDFs and text files, and manage the documents available to answer questions.
      </p>

      <div className="mt-6">
        <FileUpload onUpload={(files) => void upload(files)} isUploading={isUploading} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight">
        Documents{documents.length > 0 ? ` (${documents.length})` : ""}
      </h2>
      <DocumentList
        documents={documents}
        isLoading={isLoading}
        error={error}
        onDelete={(documentId) => void remove(documentId)}
        deletingId={deletingId}
      />
    </div>
  );
}
