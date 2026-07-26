// ChatInput: the question composer (FR-6).
// Single responsibility: capture and submit the question text. It owns
// only its draft; sending is the parent's business.

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import Button from "@/components/ui/Button";

interface ChatInputProps {
  /** Called with the question text; the parent decides what to do next. */
  onSubmit: (question: string) => void;
  /** True while an answer is streaming -- the composer locks so a second
   *  question can't overtake the first. */
  isBusy: boolean;
}

export default function ChatInput({ onSubmit, isBusy }: ChatInputProps): JSX.Element {
  const [draft, setDraft] = useState("");

  const canSubmit = draft.trim().length > 0 && !isBusy;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(draft);
    setDraft("");
  }

  // Enter sends, Shift+Enter breaks the line -- the convention every
  // chat UI uses, and questions are usually one line anyway.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      submit(event);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={isBusy}
        aria-label="Question"
        placeholder={isBusy ? "Waiting for an answer..." : "Ask a question about your documents"}
        className="max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800"
      />
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={!canSubmit}
        className="h-[2.75rem] shrink-0 px-5"
      >
        {isBusy ? "Asking..." : "Ask"}
      </Button>
    </form>
  );
}
