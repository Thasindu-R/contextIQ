// MessageBubble: renders a single chat message (user or assistant).
// Single responsibility: presentational rendering only -- including
// turning inline [n] markers into citation chips.

import { useCallback, useEffect, useState } from "react";

import CitationChip from "@/components/CitationChip";
import type { ActiveCitation, ChatMessage } from "@/hooks/useChat";

interface MessageBubbleProps {
  message: ChatMessage;
  /** The highlighted source, so this bubble's chip can show as active. */
  activeCitation: ActiveCitation | null;
  /** The pinned source, whose chip scrolls itself into view. */
  pinnedCitation: ActiveCitation | null;
  onHoverCitation: (citation: ActiveCitation | null) => void;
  onSelectCitation: (citation: ActiveCitation) => void;
  /** Regenerate this answer -- also what the error state's Retry runs. */
  onRegenerate: (messageId: string) => void;
  /** True while any turn is in flight; the per-answer actions are
   *  disabled so a second stream can't be started over the first. */
  isBusy: boolean;
}

/**
 * A run of answer text, or one resolved citation marker.
 *
 * `sourceIndex` is 0-based into the message's `sources`, while `label`
 * keeps the 1-based number the model wrote, so the chip reads the same as
 * the answer did.
 */
type AnswerSegment =
  { kind: "text"; text: string } | { kind: "citation"; sourceIndex: number; label: string };

/**
 * Matches `[1]`, `[1, 2]` and the `[Source 1]` form -- the backend labels
 * each chunk `[Source n: file.pdf, page n]` in the prompt, so the model
 * echoes either spelling.
 */
const CITATION_PATTERN = /\[(?:sources?\s*)?(\d+(?:\s*[,;]\s*\d+)*)\]/gi;

/**
 * Split answer text into plain runs and citation chips.
 *
 * A marker only becomes a chip when every number in it resolves to a
 * source; anything else stays literal text, so an answer with no sources
 * (the FR-10 refusal has none) never renders a chip pointing nowhere.
 */
function parseAnswer(text: string, sourceCount: number): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let cursor = 0;

  // A fresh regex per call: the pattern is /g, and a shared lastIndex
  // across bubbles would make matching depend on render order.
  const pattern = new RegExp(CITATION_PATTERN);
  let match = pattern.exec(text);

  while (match !== null) {
    const numbers = match[1].split(/[,;]/).map((part) => Number.parseInt(part.trim(), 10));
    const resolvable = numbers.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= sourceCount,
    );

    if (resolvable) {
      if (match.index > cursor) {
        segments.push({ kind: "text", text: text.slice(cursor, match.index) });
      }
      for (const value of numbers) {
        segments.push({ kind: "citation", sourceIndex: value - 1, label: String(value) });
      }
      cursor = match.index + match[0].length;
    }

    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

/** Shown while a turn is asked but nothing has come back yet. */
function TypingIndicator(): JSX.Element {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="Generating answer">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

const ACTION_CLASS =
  "rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100";

interface CopyButtonProps {
  text: string;
  disabled: boolean;
}

function CopyButton({ text, disabled }: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be denied or missing outside a secure
      // context; the answer text is still selectable, so stay quiet.
      setCopied(false);
    }
  }, [text]);

  return (
    <button type="button" onClick={() => void copy()} disabled={disabled} className={ACTION_CLASS}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function MessageBubble({
  message,
  activeCitation,
  pinnedCitation,
  onHoverCitation,
  onSelectCitation,
  onRegenerate,
  isBusy,
}: MessageBubbleProps): JSX.Element {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  const sources = message.sources ?? [];
  // Tokens render the moment they arrive, so a streaming bubble is just a
  // finished one with less text in it so far -- no separate branch.
  const hasText = message.content.length > 0;
  const segments = hasText ? parseAnswer(message.content, sources.length) : [];

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        {hasText ? (
          <p className="whitespace-pre-wrap">
            {segments.map((segment, index) =>
              segment.kind === "text" ? (
                <span key={index}>{segment.text}</span>
              ) : (
                <CitationChip
                  key={index}
                  label={segment.label}
                  title={sources[segment.sourceIndex]?.document}
                  isActive={
                    activeCitation?.messageId === message.id &&
                    activeCitation.sourceIndex === segment.sourceIndex
                  }
                  isPinned={
                    pinnedCitation?.messageId === message.id &&
                    pinnedCitation.sourceIndex === segment.sourceIndex
                  }
                  onHoverStart={() =>
                    onHoverCitation({ messageId: message.id, sourceIndex: segment.sourceIndex })
                  }
                  onHoverEnd={() => onHoverCitation(null)}
                  onSelect={() =>
                    onSelectCitation({ messageId: message.id, sourceIndex: segment.sourceIndex })
                  }
                />
              ),
            )}
          </p>
        ) : null}

        {message.status === "pending" ? <TypingIndicator /> : null}

        {message.status === "error" ? (
          <div
            role="alert"
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          >
            <span>{message.error ?? "The answer could not be generated."}</span>
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              disabled={isBusy}
              className="rounded-md px-2 py-0.5 font-semibold underline underline-offset-2 transition-colors hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/50"
            >
              Retry
            </button>
          </div>
        ) : null}

        {message.status === "complete" ? (
          <div className="-mb-1 mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5 dark:border-slate-700">
            <CopyButton text={message.content} disabled={!hasText} />
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              disabled={isBusy}
              className={ACTION_CLASS}
            >
              Regenerate
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
