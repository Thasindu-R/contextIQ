// FileUpload: document upload UI (FR-1).
// Single responsibility: pick files, reject the ones the API would refuse,
// and hand the rest to the caller. No API calls (that's useDocuments) and
// no parsing (that's backend-only).

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import Button from "@/components/ui/Button";
import { useToast } from "@/hooks/useToast";

interface FileUploadProps {
  onUpload: (files: File[]) => void;
  isUploading: boolean;
}

/** Mirrors the backend's `max_upload_size_mb` default -- exceeding it is
 *  a 413, which is worth catching before spending the round trip. */
const MAX_UPLOAD_MB = 20;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** The only types the extractor handles; anything else is a 415. */
const ACCEPTED_TYPES = ["application/pdf", "text/plain"];
const ACCEPTED_EXTENSIONS = [".pdf", ".txt"];

function isAccepted(file: File): boolean {
  // Some browsers report an empty type for .txt, so fall back to the
  // extension rather than rejecting a file the backend would accept.
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  return (
    file.type === "" && ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
  );
}

export default function FileUpload({ onUpload, isUploading }: FileUploadProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { showToast } = useToast();

  function submit(files: File[]): void {
    const tooLarge = files.filter((file) => file.size > MAX_UPLOAD_BYTES);
    const wrongType = files.filter((file) => !isAccepted(file));
    const accepted = files.filter((file) => file.size <= MAX_UPLOAD_BYTES && isAccepted(file));

    if (wrongType.length > 0) {
      showToast({
        tone: "error",
        title: "Unsupported file type",
        description: `${wrongType.map((file) => file.name).join(", ")} — only PDF and plain text can be ingested.`,
      });
    }
    if (tooLarge.length > 0) {
      showToast({
        tone: "error",
        title: "File too large",
        description: `${tooLarge.map((file) => file.name).join(", ")} — the limit is ${MAX_UPLOAD_MB}MB.`,
      });
    }
    if (accepted.length > 0) {
      onUpload(accepted);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    submit(Array.from(event.target.files ?? []));
    // Reset so re-picking the same file still fires a change event.
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    submit(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.txt,application/pdf,text/plain"
        onChange={handleChange}
        disabled={isUploading}
        className="sr-only"
        aria-label="Choose documents to upload"
      />

      {isUploading ? (
        // Ingestion is synchronous with no progress endpoint, so this is
        // an indeterminate wait that can run to several seconds.
        <div role="status" className="flex flex-col items-center gap-2">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary dark:border-slate-600" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Ingesting...</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Extracting, chunking and embedding. A large PDF can take a moment.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Drop PDFs or text files here
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Up to {MAX_UPLOAD_MB}MB each. PDF and plain text only.
          </p>
          <Button
            variant="primary"
            size="md"
            className="mt-3"
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
        </>
      )}
    </div>
  );
}
