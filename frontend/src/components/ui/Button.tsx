// Button: the app's text button in its handful of variants.
// Single responsibility: presentational button styling. Behaviour comes
// from the caller via standard button props.

import type { ButtonHTMLAttributes } from "react";

import { FOCUS_RING } from "@/components/ui/focusRing";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
  ghost:
    "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
  danger: "text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "rounded-md px-2 py-1 text-xs",
  md: "rounded-xl px-4 py-2.5 text-sm",
};

export default function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  // Buttons inside a <form> default to submit, which silently reloads the
  // page; every button here is an action unless it says otherwise.
  type = "button",
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={`font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${FOCUS_RING} ${className}`}
      {...props}
    />
  );
}
