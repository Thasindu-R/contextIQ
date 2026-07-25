// Vite configuration.
// Single responsibility: build/dev-server config only.

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
});
