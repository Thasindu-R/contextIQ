// Pill: a small non-interactive status/label chip.
// Single responsibility: presentational tag styling in the app's tones.

import type { ReactNode } from "react";

export type PillTone = "neutral" | "blue" | "emerald" | "amber" | "red";

interface PillProps {
  tone?: PillTone;
  /** Renders the tone as a leading dot instead of a filled chip -- used
   *  by legends, where a row of filled chips would shout. */
  asDot?: boolean;
  title?: string;
  children: ReactNode;
}

const CHIP_CLASS: Record<PillTone, string> = {
  neutral:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const DOT_CLASS: Record<PillTone, string> = {
  neutral: "bg-slate-400",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export default function Pill({
  tone = "neutral",
  asDot = false,
  title,
  children,
}: PillProps): JSX.Element {
  if (asDot) {
    return (
      <span className="flex items-center gap-1" title={title}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />
        {children}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide ${CHIP_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
