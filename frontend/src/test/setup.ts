// Vitest setup: jest-dom matchers and the browser APIs jsdom lacks.
// Single responsibility: test environment wiring only, no test cases.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Without `globals: true` nothing auto-cleans between tests, and a leaked
// DOM turns "found one element" assertions into ambiguous-match failures.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and both are called during render:
// scrollIntoView by the citation/source pinning, matchMedia by useTheme.
Element.prototype.scrollIntoView = vi.fn();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom's crypto has getRandomValues but not always randomUUID, which
// useChat uses for message ids.
if (typeof crypto.randomUUID !== "function") {
  let counter = 0;
  Object.defineProperty(crypto, "randomUUID", {
    writable: true,
    value: () => `test-uuid-${(counter += 1)}`,
  });
}
