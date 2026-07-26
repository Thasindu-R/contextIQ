// Toast: transient error banner for upload/fetch failures.
// Single responsibility: presentational notification with a dismiss action.

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export default function Toast({ message, onDismiss }: ToastProps): JSX.Element {
  return (
    // role="alert" so a screen reader announces the failure immediately —
    // this appears in a corner the user is unlikely to be looking at.
    <div
      role="alert"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-red-200 bg-white p-4 shadow-lg dark:border-red-900/60 dark:bg-slate-900"
    >
      <span aria-hidden="true" className="mt-0.5 text-red-500">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-5 w-5"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
      </span>
      <p className="flex-1 text-sm text-slate-700 dark:text-slate-200">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded text-slate-400 transition-colors hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:text-slate-200"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-4 w-4"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
