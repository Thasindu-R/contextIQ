// MessageList: the scrolling conversation thread (FR-6).
// Single responsibility: lay out message bubbles and the empty state,
// keeping the newest turn in view. No API calls or chat state.

import { useEffect, useRef } from "react";

import MessageBubble from "@/components/MessageBubble";
import EmptyState from "@/components/ui/EmptyState";
import type { ActiveCitation, ChatMessage } from "@/hooks/useChat";

interface MessageListProps {
  messages: ChatMessage[];
  activeCitation: ActiveCitation | null;
  pinnedCitation: ActiveCitation | null;
  onHoverCitation: (citation: ActiveCitation | null) => void;
  onSelectCitation: (citation: ActiveCitation) => void;
  onRegenerate: (messageId: string) => void;
  isBusy: boolean;
}

export default function MessageList({
  messages,
  activeCitation,
  pinnedCitation,
  onHoverCitation,
  onSelectCitation,
  onRegenerate,
  isBusy,
}: MessageListProps): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  // Follows tokens as they land, not just whole turns, so a long answer
  // stays pinned to the bottom while it streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <EmptyState
        size="page"
        title="Ask a question about your documents"
        description="Answers are grounded in what you have uploaded, with a citation for every source used."
      />
    );
  }

  return (
    // role="log" is the chat-transcript role: assistive tech announces
    // appended turns without re-reading the whole thread.
    <div
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-busy={isBusy}
      className="flex flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6"
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          activeCitation={activeCitation}
          pinnedCitation={pinnedCitation}
          onHoverCitation={onHoverCitation}
          onSelectCitation={onSelectCitation}
          onRegenerate={onRegenerate}
          isBusy={isBusy}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
