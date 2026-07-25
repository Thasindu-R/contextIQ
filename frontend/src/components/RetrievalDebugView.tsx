// RetrievalDebugView: shows semantic vs keyword contribution per answer.
// Single responsibility: presentational breakdown of retrieved chunks
// and their source (semantic/keyword/fused) and scores, per spec 7.2.

import type { RetrievalMode, RetrievedChunkOut } from "@/types";

interface RetrievalDebugViewProps {
  chunks: RetrievedChunkOut[];
  mode: RetrievalMode | null;
}

export default function RetrievalDebugView(_props: RetrievalDebugViewProps): JSX.Element {
  // TODO: render a table/list of retrieved chunks with source + score.
  throw new Error("Not implemented");
}
