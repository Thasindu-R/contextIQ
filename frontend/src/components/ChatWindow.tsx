// ChatWindow: conversational Q&A interface (FR-6).
// Single responsibility: compose the thread, the document filter, the
// composer and the Sources panel, and wire them to useChat. No direct
// API calls.

import { useEffect, useMemo, useState } from "react";

import ChatInput from "@/components/ChatInput";
import DocumentFilter from "@/components/DocumentFilter";
import MessageList from "@/components/MessageList";
import SourcesPanel from "@/components/SourcesPanel";
import Button from "@/components/ui/Button";
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

  // Escape closes the panel from anywhere -- on a narrow screen it takes
  // up half the view, so getting rid of it has to be one key away.
  useEffect(() => {
    if (!isPanelOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setIsPanelOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen]);

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
  const sourceCount = panelMessage?.sources?.length ?? 0;

  return (
    // Side by side on a wide screen; stacked, with the panel capped to
    // just under half the height, once there is no room for a rail.
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
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

        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6 sm:py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">Scope</span>
            <DocumentFilter
              documents={readyDocuments}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              isLoading={isLoading}
              error={error}
              disabled={isStreaming}
            />

            {!isPanelOpen ? (
              <Button
                variant="secondary"
                onClick={() => setIsPanelOpen(true)}
                className="ml-auto py-1.5"
              >
                Sources{sourceCount > 0 ? ` (${sourceCount})` : ""}
              </Button>
            ) : null}
          </div>

          <ChatInput
            onSubmit={(question) => ask(question, { documentIds: selectedIds })}
            isBusy={isStreaming}
          />
        </div>
      </div>

      {isPanelOpen ? (
        <aside
          aria-label="Sources"
          className="flex max-h-[45%] shrink-0 border-t border-slate-200 dark:border-slate-800 lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0"
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
      ) : null}
    </div>
  );
}
