// Tailwind CSS configuration.
// Single responsibility: theme/content-glob config only.

/** @type {import('tailwindcss').Config} */
export default {
  // Class strategy (not "media") so the in-app toggle can override the OS
  // preference; src/hooks/useTheme.ts owns the `dark` class on <html>.
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens. Surfaces, text, and borders deliberately use
        // Tailwind's built-in `slate` scale rather than a custom alias, so
        // the full 50-950 range stays available without re-declaring it.
        primary: {
          DEFAULT: "#4F46E5",
          hover: "#4338CA",
        },
        accent: "#F59E0B",
        success: "#10B981",
      },
    },
  },
  plugins: [],
};
