// AskPage: the chat route (FR-6).
// Single responsibility: page-level composition for asking questions.
// All chat behaviour lives in <ChatWindow /> and the useChat hook.

import ChatWindow from "@/components/ChatWindow";

export default function AskPage(): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h1 className="text-lg font-semibold tracking-tight">Ask</h1>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
          Answers grounded in your uploaded documents, with citations.
        </p>
      </header>

      <div className="min-h-0 flex-1">
        <ChatWindow />
      </div>
    </div>
  );
}
