// CitationBadge: displays a source/location citation (FR-9).
// Single responsibility: presentational rendering of a single citation.

interface CitationBadgeProps {
  document: string;
  page: number | null;
}

export default function CitationBadge(_props: CitationBadgeProps): JSX.Element {
  // TODO: render a small badge like "document.pdf, p. 4".
  throw new Error("Not implemented");
}
