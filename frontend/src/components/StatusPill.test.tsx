// Tests for StatusPill: every DocumentStatus renders a label and a tone.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatusPill from "@/components/StatusPill";
import type { DocumentStatus } from "@/types";

const CASES: Array<{ status: DocumentStatus; label: string; toneClass: string }> = [
  { status: "pending", label: "Pending", toneClass: "bg-slate-100" },
  { status: "processing", label: "Processing", toneClass: "bg-blue-50" },
  { status: "ready", label: "Ready", toneClass: "bg-emerald-50" },
  { status: "failed", label: "Failed", toneClass: "bg-red-50" },
];

describe("StatusPill", () => {
  it.each(CASES)('renders $status as "$label"', ({ status, label }) => {
    render(<StatusPill status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(CASES)("gives $status its own tone", ({ status, label, toneClass }) => {
    render(<StatusPill status={status} />);

    expect(screen.getByText(label)).toHaveClass(toneClass);
  });

  it.each(CASES)("keeps $status legible in dark mode", ({ status, label }) => {
    render(<StatusPill status={status} />);

    // Every tone ships a dark: counterpart; without it the pill's light
    // background stays white on a dark surface.
    const className = screen.getByText(label).className;
    expect(className).toMatch(/dark:bg-/);
    expect(className).toMatch(/dark:text-/);
  });

  it("distinguishes ready from failed, which is the difference that matters", () => {
    const { rerender } = render(<StatusPill status="ready" />);
    const readyClass = screen.getByText("Ready").className;

    rerender(<StatusPill status="failed" />);
    const failedClass = screen.getByText("Failed").className;

    expect(readyClass).not.toEqual(failedClass);
  });
});
