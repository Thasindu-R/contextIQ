// Application configuration read from Vite's env.
// Single responsibility: read and normalise import.meta.env once, so no
// other module touches import.meta.env directly (mirrors the backend's
// core/config.py rule).

/** Base URL of the backend API, guaranteed to have no trailing slash. */
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export const config = {
  apiBaseUrl,
} as const;

/**
 * Build an absolute URL for an API path.
 *
 * With VITE_API_BASE_URL unset this returns the path unchanged, so requests
 * stay same-origin and go through the dev-server proxy (see vite.config.ts).
 */
export function apiUrl(path: string): string {
  return `${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
