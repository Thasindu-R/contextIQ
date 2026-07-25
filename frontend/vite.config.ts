// Vite configuration.
// Single responsibility: build/dev-server config only.

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
// vitest/config re-exports Vite's defineConfig with the `test` key added,
// so the dev/build config and the test config stay in one file sharing one
// set of path aliases.
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
    // The api tests stub global fetch, so no DOM is needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
