// SourcesPanel: the retrieved passages behind the current answer (FR-9, FR-15).
// Single responsibility: presentational rendering of one answer's sources,
// including which retriever surfaced each one. No API calls or chat state.

import { useEffect, useRef, useState } from "react";

import CitationBadge from "@/components/CitationBadge";
import type { ActiveCitation, ChatMessage } from "@/hooks/useChat";
import type { CitationOut, RetrievalMode, RetrievalSource, RetrievedChunkOut } from "@/types";

interface SourcesPanelProps {
  /** The answer whose sources are shown, or null before the first one. */
  message: ChatMessage | null;
  activeCitation: ActiveCitation | null;
  /** Scrolls its card into view when it changes -- a hover only
   *  highlights, a click brings the source to the reader. */
  pinnedCitation: ActiveCitation | null;
  onHoverCitation: (citation: ActiveCitation | null) => void;
  onSelectCitation: (citation: ActiveCitation) => void;
  onClose: () => void;
}

const MODE_LABEL: Record<RetrievalMode, string> = {
  semantic: "Semantic search",
  keyword: "Keyword search",
  hybrid: "Hybrid search, RRF fused",
};

/**
 * How to read a score, per mode.
 *
 * Scores are not comparable across modes and do not even point the same
 * way: pgvector's `<=>` is a cosine *distance* (nearer is smaller) while
 * `ts_rank_cd` and the RRF fused score are strengths (bigger is better).
 * So each mode carries its own metric name and direction, and nothing
 * here normalises, re-sorts, or renders a score as a bar or percentage --
 * results already arrive best-first and are shown in that order.
 */
const SCORE_META: Record<RetrievalMode, { metric: string; lowerIsBetter: boolean }> = {
  semantic: { metric: "cosine distance", lowerIsBetter: true },
  keyword: { metric: "ts_rank_cd", lowerIsBetter: false },
  hybrid: { metric: "RRF score", lowerIsBetter: false },
};

interface RetrieverTagStyle {
  label: string;
  description: string;
  dot: string;
  chip: string;
}

/** Which leg surfaced the chunk. "Both" is the one worth noticing: it is
 *  the agreement between the two retrievers that RRF rewards. */
const RETRIEVER_TAGS: Record<RetrievalSource, RetrieverTagStyle> = {
  semantic: {
    label: "Semantic",
    description: "found by embedding similarity",
    dot: "bg-blue-500",
    chip: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  },
  keyword: {
    label: "Keyword",
    description: "found by full-text search",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  both: {
    label: "Both",
    description: "found by both, which is what RRF rewards",
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
};

/** Long enough to judge relevance, short enough to scan a list of five. */
const SNIPPET_LIMIT = 240;

function RetrieverTag({ source }: { source: RetrievalSource }): JSX.Element {
  const tag = RETRIEVER_TAGS[source];
  return (
    <span
      title={`${tag.label}: ${tag.description}`}
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide ${tag.chip}`}
    >
      {tag.label}
    </span>
  );
}

function Legend(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-slate-500 dark:text-slate-400">
      <span>Surfaced by</span>
      {(Object.keys(RETRIEVER_TAGS) as RetrievalSource[]).map((source) => (
        <span
          key={source}
          className="flex items-center gap-1"
          title={RETRIEVER_TAGS[source].description}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${RETRIEVER_TAGS[source].dot}`} />
          {RETRIEVER_TAGS[source].label}
        </span>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  body: string;
}

function EmptyState({ title, body }: EmptyStateProps): JSX.Element {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className="mx-auto mt-1 max-w-[16rem] text-xs text-slate-500 dark:text-slate-400">
        {body}
      </p>
    </div>
  );
}

interface SourceCardProps {
  /** 1-based, matching the [n] marker in the answer. */
  number: number;
  chunk: RetrievedChunkOut;
  /** The parallel citation, which is where the filename lives. */
  citation: CitationOut | undefined;
  mode: RetrievalMode;
  isActive: boolean;
  isPinned: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onSelect: () => void;
}

function SourceCard({
  number,
  chunk,
  citation,
  mode,
  isActive,
  isPinned,
  onHoverStart,
  onHoverEnd,
  onSelect,
}: SourceCardProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!isPinned) return;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isPinned]);

  const score = SCORE_META[mode];
  const isTruncated = chunk.text.length > SNIPPET_LIMIT;
  const shownText =
    isTruncated && !isExpanded ? `${chunk.text.slice(0, SNIPPET_LIMIT).trimEnd()}...` : chunk.text;

  return (
    <li
      ref={cardRef}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`rounded-xl border p-3 transition-colors ${
        isActive
          ? "border-accent bg-accent/5 dark:bg-accent/10"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        onFocus={onHoverStart}
        onBlur={onHoverEnd}
        aria-pressed={isPinned}
        className="flex w-full items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
            isActive
              ? "bg-accent text-white"
              : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {number}
        </span>
        <span className="min-w-0 flex-1">
          <CitationBadge document={citation?.document ?? "Unknown document"} page={chunk.page} />
        </span>
        <RetrieverTag source={chunk.source} />
      </button>

      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {shownText}
      </p>

      {isTruncated ? (
        <button
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="mt-1 text-[0.6875rem] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-indigo-400"
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[0.6875rem] text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <span
          className="font-mono"
          title={`${score.metric}: ${score.lowerIsBetter ? "lower" : "higher"} is more relevant, and only comparable with other ${mode} results`}
        >
          <span aria-hidden="true">{score.lowerIsBetter ? "↓" : "↑"}</span> {chunk.score.toFixed(4)}
        </span>
        {/* Ranks are the hybrid story in miniature: where each leg placed
            this chunk before fusion. At least one is always set. */}
        {chunk.semantic_rank !== null ? (
          <span title="Position in the semantic leg">semantic #{chunk.semantic_rank}</span>
        ) : null}
        {chunk.keyword_rank !== null ? (
          <span title="Position in the keyword leg">keyword #{chunk.keyword_rank}</span>
        ) : null}
      </div>
    </li>
  );
}

export default function SourcesPanel({
  message,
  activeCitation,
  pinnedCitation,
  onHoverCitation,
  onSelectCitation,
  onClose,
}: SourcesPanelProps): JSX.Element {
  const chunks = message?.chunks ?? [];
  const citations = message?.sources ?? [];
  const mode = message?.retrievalMode ?? null;
  const hasSources = mode !== null && chunks.length > 0;

  function renderBody(): JSX.Element {
    if (message === null) {
      return (
        <EmptyState
          title="No sources yet"
          body="Ask a question and the passages behind the answer appear here."
        />
      );
    }
    if (message.status === "pending" || message.status === "streaming") {
      return <EmptyState title="Retrieving" body="Sources arrive with the finished answer." />;
    }
    if (message.status === "error") {
      return <EmptyState title="No sources" body="This answer could not be generated." />;
    }
    // A null retrieval_mode is the no-context answer: retrieval found
    // nothing, so there is genuinely nothing to show. Not an error.
    if (!hasSources) {
      return (
        <EmptyState
          title="No sources"
          body="Retrieval found nothing to ground this answer in, so it was refused rather than guessed."
        />
      );
    }

    return (
      <ol className="space-y-2.5 px-4 pb-4">
        {chunks.map((chunk, index) => (
          <SourceCard
            key={chunk.chunk_id}
            number={index + 1}
            chunk={chunk}
            citation={citations[index]}
            mode={mode}
            isActive={
              activeCitation?.messageId === message.id && activeCitation.sourceIndex === index
            }
            isPinned={
              pinnedCitation?.messageId === message.id && pinnedCitation.sourceIndex === index
            }
            onHoverStart={() => onHoverCitation({ messageId: message.id, sourceIndex: index })}
            onHoverEnd={() => onHoverCitation(null)}
            onSelect={() => onSelectCitation({ messageId: message.id, sourceIndex: index })}
          />
        ))}
      </ol>
    );
  }

  return (
    <div className="flex h-full w-[22rem] flex-col bg-slate-50 dark:bg-slate-900">
      <header className="shrink-0 space-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Sources</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide sources"
            className="rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {hasSources && mode !== null ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {MODE_LABEL[mode]} · {chunks.length} {chunks.length === 1 ? "passage" : "passages"}
            </p>
            {/* Stated once, up top: the number on each card means nothing
                without knowing which metric it is and which way it runs. */}
            <p className="text-[0.6875rem] text-slate-500 dark:text-slate-400">
              Scores are {SCORE_META[mode].metric} —{" "}
              {SCORE_META[mode].lowerIsBetter ? "lower" : "higher"} is more relevant. Comparable
              only within this mode.
            </p>
            <Legend />
          </>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-3">{renderBody()}</div>
    </div>
  );
}
