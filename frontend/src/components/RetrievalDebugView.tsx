// RetrievalDebugView: shows semantic vs keyword contribution per answer.
// Single responsibility: presentational breakdown of retrieved chunks
// and their source (semantic/keyword/fused) and scores, per spec 7.2.

import type { RetrievalMode, Source } from "@/types";

interface RetrievalDebugViewProps {
  sources: Source[];
  /** Null on the no-context refusal. Scores are only interpretable
   *  against the mode that produced them, so label them with it. */
  mode: RetrievalMode | null;
}

export default function RetrievalDebugView(_props: RetrievalDebugViewProps): JSX.Element {
  // TODO: render a table/list of sources with retriever + ranks + score.
  throw new Error("Not implemented");
}
