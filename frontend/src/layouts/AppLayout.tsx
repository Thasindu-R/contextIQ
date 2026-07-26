// AppLayout: the shell every route renders inside.
// Single responsibility: navigation + content area composition.
// No data fetching or business logic.

import { NavLink, Outlet } from "react-router-dom";

import ThemeToggle from "@/components/ThemeToggle";
import { FOCUS_RING } from "@/components/ui/focusRing";

const NAV_LINKS = [
  { to: "/ask", label: "Ask" },
  { to: "/documents", label: "Library" },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base = `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${FOCUS_RING}`;
  return isActive
    ? `${base} bg-primary text-white hover:bg-primary-hover`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100`;
}

export default function AppLayout(): JSX.Element {
  return (
    // Pinned to the viewport rather than min-height: the chat route sizes
    // its own scroll regions, which needs a definite height to divide up.
    // dvh keeps that honest on mobile, where the URL bar eats into vh.
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      {/* One element, two layouts: a top bar on narrow screens, the
          sidebar from md up. */}
      <aside className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900 md:w-60 md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-0 md:py-0">
        <span className="text-base font-semibold tracking-tight md:px-5 md:py-6 md:text-lg">
          Context<span className="text-primary dark:text-indigo-400">IQ</span>
        </span>

        <nav
          className="flex flex-1 items-center gap-1 md:flex-col md:items-stretch md:space-y-1 md:px-3"
          aria-label="Main"
        >
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={navLinkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="md:border-t md:border-slate-200 md:p-3 md:dark:border-slate-800">
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
