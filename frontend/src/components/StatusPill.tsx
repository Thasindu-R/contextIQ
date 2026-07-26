// StatusPill: shows a document's ingestion state (FR-11).
// Single responsibility: presentational status badge, no data access.

import type { DocumentStatus } from "@/api/client";

interface StatusPillProps {
  status: DocumentStatus;
}

/**
 * Three colour buckets, not four: done, working, broken.
 *
 * `queued` and `embedding` share amber because the distinction matters to
 * the pipeline, not to someone waiting for a document — both mean "not
 * usable yet, nothing for you to do." Splitting them by colour would imply
 * a difference the reader can't act on.
 */
const STYLES: Record<DocumentStatus, { label: string; className: string }> = {
  ready: {
    label: "Ready",
    className: "bg-success/10 text-success ring-success/20",
  },
  queued: {
    label: "Queued",
    className: "bg-accent/10 text-accent ring-accent/20",
  },
  embedding: {
    label: "Embedding",
    className: "bg-accent/10 text-accent ring-accent/20",
  },
  error: {
    label: "Failed",
    className: "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400",
  },
};

export default function StatusPill({ status }: StatusPillProps): JSX.Element {
  const { label, className } = STYLES[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
