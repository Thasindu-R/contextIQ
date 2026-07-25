// AskPage: the chat route (FR-6).
// Single responsibility: page-level composition for asking questions.
// The chat itself lands here via <ChatWindow /> once it's implemented.

export default function AskPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Ask a question and get an answer grounded in your uploaded documents, with citations.
      </p>
    </div>
  );
}
