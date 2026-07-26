// MessageBubble: renders a single chat message (user or assistant).
// Single responsibility: presentational rendering only.

import type { Source } from "@/types";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  /** Absent until the stream's `done` frame arrives. */
  sources?: Source[];
  /** True while `content` is still growing token by token. */
  isStreaming?: boolean;
}

export default function MessageBubble(_props: MessageBubbleProps): JSX.Element {
  // TODO: render bubble styled by role; render <CitationBadge /> per source.
  // While isStreaming, render the partial content plus a caret and
  // no citations -- sources only exist once the answer is complete.
  throw new Error("Not implemented");
}
