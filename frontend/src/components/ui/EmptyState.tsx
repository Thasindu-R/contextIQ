// EmptyState: the "there is nothing here" message, in one shape.
// Single responsibility: presentational empty/placeholder block, so every
// nothing-to-show surface in the app reads the same way.

import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Optional action or hint rendered under the description. */
  children?: ReactNode;
  /** `page` centres in the available height; `panel` is the compact form
   *  for sidebars and popovers. */
  size?: "page" | "panel";
}

export default function EmptyState({
  title,
  description,
  children,
  size = "panel",
}: EmptyStateProps): JSX.Element {
  const isPage = size === "page";

  return (
    <div
      className={
        isPage
          ? "flex h-full flex-col items-center justify-center px-6 py-10 text-center"
          : "px-4 py-10 text-center"
      }
    >
      <p
        className={
          isPage
            ? "text-base font-medium text-slate-700 dark:text-slate-200"
            : "text-sm font-medium text-slate-600 dark:text-slate-300"
        }
      >
        {title}
      </p>
      {description !== undefined ? (
        <p
          className={`mx-auto mt-1.5 text-slate-500 dark:text-slate-400 ${
            isPage ? "max-w-sm text-sm" : "max-w-[16rem] text-xs"
          }`}
        >
          {description}
        </p>
      ) : null}
      {children !== undefined ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
