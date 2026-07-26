// Vite configuration.
// Single responsibility: build/dev-server/test config only.

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
// Vitest's defineConfig is Vite's plus the `test` key, so the bundler and
// the test runner keep sharing one alias definition.
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json. Both have to agree:
    // tsconfig satisfies the typechecker, this satisfies the bundler.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Lets the dev server reach the backend over a same-origin /api path,
    // so VITE_API_BASE_URL can be left empty in development and CORS never
    // enters into it.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest globals stay off: tests import describe/it/expect explicitly,
    // which keeps tsconfig free of an extra ambient types entry.
    globals: false,
    restoreMocks: true,
  },
});
