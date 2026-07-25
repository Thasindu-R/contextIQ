// useTheme: owns the light/dark theme.
// Single responsibility: resolve the active theme, apply it to <html>, and
// persist the choice. No rendering.

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Shared with the inline <head> script in index.html, which applies the
 *  stored theme before first paint to avoid a flash of the wrong theme.
 *  Changing this key means changing it there too. */
export const THEME_STORAGE_KEY = "contextiq-theme";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Stored choice if the user has made one, otherwise the OS preference. */
export function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return prefersDark() ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
