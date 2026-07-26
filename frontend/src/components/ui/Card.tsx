// Card: a bordered surface that adapts to light and dark mode.
// Single responsibility: presentational surface styling.

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Renders as an <li> inside lists, so cards don't force a wrapper
   *  element between the list and its items. */
  as?: "div" | "li";
  /** Highlighted state -- amber, matching the citation chips. */
  isActive?: boolean;
  children: ReactNode;
}

export default function Card({
  as = "div",
  isActive = false,
  className = "",
  children,
  ...props
}: CardProps): JSX.Element {
  const Element = as;
  const tone = isActive
    ? "border-accent bg-accent/5 dark:bg-accent/10"
    : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800";

  return (
    <Element className={`rounded-xl border transition-colors ${tone} ${className}`} {...props}>
      {children}
    </Element>
  );
}
