// ChatWindow: conversational Q&A interface (FR-6).
// Single responsibility: compose the thread, the document filter, the
// composer and the Sources panel, and wire them to useChat. No direct
// API calls.

import { useMemo, useState } from "react";

import ChatInput from "@/components/ChatInput";
import DocumentFilter from "@/components/DocumentFilter";
import MessageList from "@/components/MessageList";
import SourcesPanel from "@/components/SourcesPanel";
import type { ChatMessage } from "@/hooks/useChat";
import { useChat } from "@/hooks/useChat";
import { useDocuments } from "@/hooks/useDocuments";

/**
 * The answer whose sources the panel shows: the pinned one if the reader
 * clicked into an earlier turn, otherwise the latest answer. A hover
 * deliberately does not switch panels -- it only previews a highlight, so
 * pointing at an old marker cannot yank the panel out from under you.
 */
function findPanelMessage(
  messages: ChatMessage[],
  pinnedMessageId: string | null,
): ChatMessage | null {
  if (pinnedMessageId !== null) {
    const pinned = messages.find((message) => message.id === pinnedMessageId);
    if (pinned) return pinned;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return null;
}

export default function ChatWindow(): JSX.Element {
  const {
    messages,
    isStreaming,
    activeCitation,
    pinnedCitation,
    ask,
    regenerate,
    hoverCitation,
    selectCitation,
  } = useChat();
  const { documents, isLoading, error } = useDocuments();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Only a fully ingested document can be searched -- ingestion is
  // synchronous, so anything else is a failure rather than a wait.
  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === "ready"),
    [documents],
  );

  const panelMessage = useMemo(
    () => findPanelMessage(messages, pinnedCitation?.messageId ?? null),
    [messages, pinnedCitation],
  );
  const sourceCount = panelMessage?.chunks?.length ?? 0;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList
            messages={messages}
            activeCitation={activeCitation}
            pinnedCitation={pinnedCitation}
            onHoverCitation={hoverCitation}
            onSelectCitation={selectCitation}
            onRegenerate={regenerate}
            isBusy={isStreaming}
          />
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Scope</span>
            <DocumentFilter
              documents={readyDocuments}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              isLoading={isLoading}
              error={error}
              disabled={isStreaming}
            />

            {!isPanelOpen ? (
              <button
                type="button"
                onClick={() => setIsPanelOpen(true)}
                className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Sources{sourceCount > 0 ? ` (${sourceCount})` : ""}
              </button>
            ) : null}
          </div>

          <ChatInput
            onSubmit={(question) => ask(question, { documentIds: selectedIds })}
            isBusy={isStreaming}
          />
        </div>
      </div>

      {/* Animating the width rather than mounting/unmounting keeps the
          panel's scroll position across a hide/show. */}
      <aside
        aria-label="Sources"
        className={`shrink-0 overflow-hidden border-slate-200 transition-[width] duration-200 dark:border-slate-800 ${
          isPanelOpen ? "w-[22rem] border-l" : "w-0"
        }`}
      >
        <SourcesPanel
          message={panelMessage}
          activeCitation={activeCitation}
          pinnedCitation={pinnedCitation}
          onHoverCitation={hoverCitation}
          onSelectCitation={selectCitation}
          onClose={() => setIsPanelOpen(false)}
        />
      </aside>
    </div>
  );
}
