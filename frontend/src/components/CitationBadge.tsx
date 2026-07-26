// CitationBadge: displays a source/location citation (FR-9).
// Single responsibility: presentational rendering of a single citation.

interface CitationBadgeProps {
  document: string;
  page: number | null;
}

export default function CitationBadge({ document, page }: CitationBadgeProps): JSX.Element {
  return (
    // The filename wins the space: plain text is often page-less, and a
    // truncated page number is useless where a truncated name is not.
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
      <span className="truncate font-medium text-slate-700 dark:text-slate-200">{document}</span>
      {page !== null ? (
        <span className="shrink-0 text-slate-500 dark:text-slate-400">p. {page}</span>
      ) : null}
    </span>
  );
}
