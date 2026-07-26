// MessageList: the scrolling conversation thread (FR-6).
// Single responsibility: lay out message bubbles and the empty state,
// keeping the newest turn in view. No API calls or chat state.

import { useEffect, useRef } from "react";

import MessageBubble from "@/components/MessageBubble";
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

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-medium text-slate-700 dark:text-slate-200">
        Ask a question about your documents
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Answers are grounded in what you have uploaded, with a citation for every source used.
      </p>
    </div>
  );
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
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6" aria-live="polite">
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
