// IconButton: a button whose content is an icon or glyph.
// Single responsibility: presentational icon button that cannot be built
// without an accessible name -- `label` is required, not optional.

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { FOCUS_RING } from "@/components/ui/focusRing";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Announced by screen readers and shown as the tooltip. State the
   *  action ("Hide sources"), not the icon ("X"). */
  label: string;
  children: ReactNode;
}

export default function IconButton({
  label,
  children,
  className = "",
  type = "button",
  ...props
}: IconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${FOCUS_RING} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
