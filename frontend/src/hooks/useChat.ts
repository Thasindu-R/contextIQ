// useChat: state management hook for the chat interface (FR-6).
// Single responsibility: own message history state and orchestrate
// calls to api/client.askQuestion. No rendering logic.

import type { Source } from "@/api/client";
import type { RetrievalMode } from "@/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant messages once the stream's `done` frame has
   *  arrived; carries the citations and retrieval provenance the debug
   *  view renders. Absent while tokens are still streaming in. */
  sources?: Source[];
  /** Which mode produced `sources`. Null on the no-context refusal, and
   *  needed to label each score correctly (the scales differ by mode). */
  mode?: RetrievalMode | null;
  /** True while this message is still being streamed into. */
  isStreaming?: boolean;
}

interface UseChatResult {
  messages: ChatMessage[];
  sendMessage: (question: string, mode: RetrievalMode) => Promise<void>;
  isLoading: boolean;
}

export function useChat(): UseChatResult {
  // TODO: manage message list state; drive api/client.askQuestion's
  // async generator, appending `token` text to the in-flight assistant
  // message and attaching the final `sources` event to it.
  throw new Error("Not implemented");
}
