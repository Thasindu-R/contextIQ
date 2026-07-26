// DocumentsPage: the library route (FR-1, FR-11).
// Single responsibility: page-level composition for managing documents.
// <FileUpload /> and <DocumentList /> land here once implemented.

export default function DocumentsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Library</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Upload PDFs and text files, and manage the documents available to answer questions.
      </p>
    </div>
  );
}
