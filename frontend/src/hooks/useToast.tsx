// useToast: the app-wide transient notification queue.
// Single responsibility: own toast state and its timers, and expose a way
// to raise one. Rendering belongs to components/ui/ToastRegion.
//
// The provider and its hook are two halves of one contract; splitting
// them across files purely to satisfy react-refresh's "components only"
// preference would buy nothing, so that rule is off for this file.
/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import ToastRegion from "@/components/ui/ToastRegion";

export interface Toast {
  id: string;
  tone: "error" | "info";
  title: string;
  description?: string;
}

export type ToastInput = Omit<Toast, "id">;

/** Long enough to read a sentence, short enough not to sit in the way. */
const DISMISS_AFTER_MS = 6000;

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const timers = timersRef;
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((current) => {
        // A failing poll would otherwise stack the same message forever.
        const isDuplicate = current.some(
          (existing) =>
            existing.title === toast.title && existing.description === toast.description,
        );
        return isDuplicate ? current : [...current, { ...toast, id }];
      });
      timersRef.current.push(window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return context;
}
