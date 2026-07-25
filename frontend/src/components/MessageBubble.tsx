// MessageBubble: renders a single chat message (user or assistant).
// Single responsibility: presentational rendering only.

import type { CitationOut } from "@/types";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  citations?: CitationOut[];
}

export default function MessageBubble(_props: MessageBubbleProps): JSX.Element {
  // TODO: render bubble styled by role; render <CitationBadge /> per citation.
  throw new Error("Not implemented");
}
