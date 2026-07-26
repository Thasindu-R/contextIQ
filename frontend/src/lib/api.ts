// Public entry point for the API client.
// Single responsibility: re-export `@/api/client` under the `@/lib/api`
// import path. The implementation deliberately lives in `api/client.ts` --
// the project's one network module -- so there is a single source of truth
// rather than two clients drifting apart.

export * from "@/api/client";
