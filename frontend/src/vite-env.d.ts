/// <reference types="vite/client" />

// Types the VITE_ vars read by src/config.ts. Optional because .env.local
// is not committed and the app falls back to the dev-server proxy.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
