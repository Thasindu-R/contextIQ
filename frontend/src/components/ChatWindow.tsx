// ChatWindow: conversational Q&A interface (FR-6).
// Single responsibility: compose the thread, the document filter and the
// composer, and wire them to useChat. No direct API calls.

import { useMemo, useState } from "react";

import ChatInput from "@/components/ChatInput";
import DocumentFilter from "@/components/DocumentFilter";
import MessageList from "@/components/MessageList";
import { useChat } from "@/hooks/useChat";
import { useDocuments } from "@/hooks/useDocuments";

export default function ChatWindow(): JSX.Element {
  const { messages, isStreaming, activeCitation, ask, regenerate, hoverCitation, selectCitation } =
    useChat();
  const { documents, isLoading, error } = useDocuments();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Only a fully ingested document can be searched -- ingestion is
  // synchronous, so anything else is a failure rather than a wait.
  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === "ready"),
    [documents],
  );

  // The Sources panel (which reads `activeCitation` and the selected
  // message's `sources`) lands alongside this column in a later step.
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          activeCitation={activeCitation}
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
        </div>

        <ChatInput
          onSubmit={(question) => ask(question, { documentIds: selectedIds })}
          isBusy={isStreaming}
        />
      </div>
    </div>
  );
}
