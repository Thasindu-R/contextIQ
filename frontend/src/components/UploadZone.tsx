// UploadZone: drag-and-drop / click-to-browse document upload (FR-1).
// Single responsibility: file selection UI. It hands files to its parent
// and never touches the network itself.

import { useRef, useState } from "react";

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  /** The input's `accept` list, owned by the hook that knows what the
   *  backend will ingest. */
  accept: string;
  disabled?: boolean;
}

export default function UploadZone({ onFiles, accept, disabled }: UploadZoneProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag events fire on every child element, so a boolean flag set by
  // dragenter/dragleave flickers. Counting entries against leaves is what
  // keeps the highlight steady while the pointer moves across the zone.
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null): void {
    if (!fileList || fileList.length === 0) {
      return;
    }
    onFiles(Array.from(fileList));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (!disabled) {
      handleFiles(event.dataTransfer.files);
    }
  }

  const stateClasses = isDragging
    ? "border-primary bg-primary/5"
    : "border-slate-300 hover:border-primary/60 dark:border-slate-700 dark:hover:border-primary/60";

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          setIsDragging(false);
        }
      }}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed transition-colors ${stateClasses} ${
        disabled ? "opacity-60" : ""
      }`}
    >
      {/* A button, not a clickable div: it's keyboard-reachable and
          announces itself without any extra role/tabIndex wiring. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 px-6 py-10 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed dark:focus-visible:ring-offset-slate-950"
      >
        <UploadIcon />
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Drop a document here, or click to browse
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          PDF or plain text, up to 20MB
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so picking the same file twice in a row still fires
          // onChange the second time.
          event.target.value = "";
        }}
      />
    </div>
  );
}

function UploadIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 text-slate-400 dark:text-slate-500"
    >
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
