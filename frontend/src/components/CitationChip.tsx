// CitationChip: an inline [n] citation marker inside an answer (FR-9).
// Single responsibility: presentational rendering of one marker plus the
// hover/click intent that highlights its source. No state of its own.

import { useEffect, useRef } from "react";

import { FOCUS_RING_TIGHT } from "@/components/ui/focusRing";

interface CitationChipProps {
  /** What the marker reads as -- the 1-based source number. */
  label: string;
  /** True when this chip's source is the one currently highlighted. */
  isActive: boolean;
  /** True when its source is the pinned one, which may have been pinned
   *  from the Sources panel -- so scroll this marker into view. */
  isPinned: boolean;
  /** Filename of the source it points at, for the tooltip. */
  title?: string;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onSelect: () => void;
}

export default function CitationChip({
  label,
  isActive,
  isPinned,
  title,
  onHoverStart,
  onHoverEnd,
  onSelect,
}: CitationChipProps): JSX.Element {
  const chipRef = useRef<HTMLButtonElement>(null);

  // The panel-to-answer half of the link: clicking a source card brings
  // its marker into view. A no-op when the chip was the thing clicked.
  useEffect(() => {
    if (!isPinned) return;
    chipRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isPinned]);

  const base = `mx-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border px-1.5 align-baseline text-[0.6875rem] font-semibold leading-none transition-colors ${FOCUS_RING_TIGHT}`;
  const tone = isActive
    ? "border-accent bg-accent text-white"
    : "border-accent/40 bg-accent/15 text-amber-700 hover:bg-accent/30 dark:text-amber-300";

  return (
    <button
      ref={chipRef}
      type="button"
      // Hover and focus are the same intent, so keyboard users get the
      // highlight without having to activate the chip.
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      onClick={onSelect}
      aria-pressed={isActive}
      title={title ? `Source ${label}: ${title}` : `Source ${label}`}
      className={`${base} ${tone}`}
    >
      {label}
    </button>
  );
}
