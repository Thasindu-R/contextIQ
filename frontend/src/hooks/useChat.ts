// useChat: state management hook for the chat interface (FR-6).
// Single responsibility: own message history state and orchestrate
// calls to api/client.askQuestion. No rendering logic.

import type { AnswerResponse, RetrievalMode } from "@/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant messages; carries citations and the retrieval
   *  provenance the debug view renders. */
  answer?: AnswerResponse;
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
