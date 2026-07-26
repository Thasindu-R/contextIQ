// ToastRegion: renders the stack of transient notifications.
// Single responsibility: presentational rendering only -- the queue and
// its timers live in hooks/useToast.

import IconButton from "@/components/ui/IconButton";
import type { Toast } from "@/hooks/useToast";

interface ToastRegionProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const TONE_CLASS: Record<Toast["tone"], string> = {
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  info: "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
};

export default function ToastRegion({ toasts, onDismiss }: ToastRegionProps): JSX.Element | null {
  if (toasts.length === 0) return null;

  return (
    <div
      // Bottom-anchored so it never covers the app's header or nav, and
      // full-width on narrow screens where a floating card would crop.
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-80"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          // Errors interrupt; anything else waits its turn.
          role={toast.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border p-3 shadow-lg ${TONE_CLASS[toast.tone]}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.description !== undefined ? (
              <p className="mt-0.5 break-words text-xs opacity-80">{toast.description}</p>
            ) : null}
          </div>
          <IconButton
            label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
            className="-m-1 shrink-0 text-current hover:bg-black/5 dark:hover:bg-white/10"
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ✕
            </span>
          </IconButton>
        </div>
      ))}
    </div>
  );
}
