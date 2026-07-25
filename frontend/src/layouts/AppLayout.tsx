// AppLayout: the shell every route renders inside.
// Single responsibility: sidebar navigation + content area composition.
// No data fetching or business logic.

import { NavLink, Outlet } from "react-router-dom";

import ThemeToggle from "@/components/ThemeToggle";

const NAV_LINKS = [
  { to: "/ask", label: "Ask" },
  { to: "/documents", label: "Library" },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base =
    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return isActive
    ? `${base} bg-primary text-white hover:bg-primary-hover`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100`;
}

export default function AppLayout(): JSX.Element {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="px-5 py-6">
          <span className="text-lg font-semibold tracking-tight">
            Context<span className="text-primary">IQ</span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={navLinkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <ThemeToggle />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
