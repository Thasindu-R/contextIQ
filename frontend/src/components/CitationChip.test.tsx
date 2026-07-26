// Tests for inline citation markers: how answer text is parsed into
// chips, and how a chip reports hover/click intent.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MessageBubble from "@/components/MessageBubble";
import type { ChatMessage } from "@/hooks/useChat";
import { ToastProvider } from "@/hooks/useToast";
import type { SourceOut } from "@/types";

function source(document: string): SourceOut {
  return {
    chunk_id: `chunk-${document}`,
    document_id: `doc-${document}`,
    document,
    page: 1,
    snippet: "...",
    text: "...",
    score: 0.0164,
    source: "both",
    semantic_rank: 1,
    keyword_rank: 1,
  };
}

interface RenderOptions {
  content: string;
  sources?: SourceOut[];
  activeIndex?: number | null;
  onHoverCitation?: (citation: unknown) => void;
  onSelectCitation?: (citation: unknown) => void;
}

function renderAnswer({
  content,
  sources = [source("a.pdf"), source("b.pdf")],
  activeIndex = null,
  onHoverCitation = vi.fn(),
  onSelectCitation = vi.fn(),
}: RenderOptions) {
  const message: ChatMessage = {
    id: "answer-1",
    role: "assistant",
    status: "complete",
    content,
    sources,
    retrievalMode: "hybrid",
  };

  return render(
    <ToastProvider>
      <MessageBubble
        message={message}
        activeCitation={
          activeIndex === null ? null : { messageId: "answer-1", sourceIndex: activeIndex }
        }
        pinnedCitation={null}
        onHoverCitation={onHoverCitation}
        onSelectCitation={onSelectCitation}
        onRegenerate={vi.fn()}
        isBusy={false}
      />
    </ToastProvider>,
  );
}

/** Citation chips are the only aria-pressed buttons inside an answer. */
function chips(): HTMLElement[] {
  return screen.getAllByRole("button").filter((node) => node.hasAttribute("aria-pressed"));
}

describe("citation marker parsing", () => {
  it("turns [1] and [2] into chips when both resolve to a source", () => {
    renderAnswer({ content: "Renews annually [1] and fees are fixed [2]." });

    expect(chips().map((chip) => chip.textContent)).toEqual(["1", "2"]);
  });

  it("expands a grouped marker into one chip per source", () => {
    renderAnswer({ content: "Both agree [1, 2] on this." });

    expect(chips().map((chip) => chip.textContent)).toEqual(["1", "2"]);
  });

  it("accepts the [Source n] spelling the prompt's context labels invite", () => {
    renderAnswer({ content: "See [Source 2] for detail." });

    expect(chips().map((chip) => chip.textContent)).toEqual(["2"]);
  });

  it("leaves an out-of-range marker as literal text", () => {
    renderAnswer({ content: "Out of range [5] stays literal." });

    expect(chips()).toHaveLength(0);
    expect(screen.getByText(/Out of range \[5\] stays literal\./)).toBeInTheDocument();
  });

  it("renders no chips at all when the answer has no sources", () => {
    // The FR-10 refusal: a completed answer whose sources array is empty.
    renderAnswer({
      content: "I cannot answer this question based on the available documents.",
      sources: [],
    });

    expect(chips()).toHaveLength(0);
    expect(
      screen.getByText("I cannot answer this question based on the available documents."),
    ).toBeInTheDocument();
  });

  it("keeps a half-arrived marker as text while tokens are still streaming", () => {
    renderAnswer({ content: "Partially streamed [1" });

    expect(chips()).toHaveLength(0);
  });

  it("names the source document in the chip's tooltip", () => {
    renderAnswer({ content: "Renews annually [2]." });

    expect(chips()[0]).toHaveAttribute("title", "Source 2: b.pdf");
  });
});

describe("citation chip interaction", () => {
  it("reports hover start and end with the 0-based source index", async () => {
    const onHoverCitation = vi.fn();
    renderAnswer({ content: "Fees are fixed [2].", onHoverCitation });

    await userEvent.hover(chips()[0]);
    expect(onHoverCitation).toHaveBeenCalledWith({ messageId: "answer-1", sourceIndex: 1 });

    await userEvent.unhover(chips()[0]);
    expect(onHoverCitation).toHaveBeenLastCalledWith(null);
  });

  it("reports a click as a selection", async () => {
    const onSelectCitation = vi.fn();
    renderAnswer({ content: "Renews annually [1].", onSelectCitation });

    await userEvent.click(chips()[0]);

    expect(onSelectCitation).toHaveBeenCalledWith({ messageId: "answer-1", sourceIndex: 0 });
  });

  it("marks only the active source's chip as pressed", () => {
    renderAnswer({ content: "One [1] and two [2].", activeIndex: 1 });

    const [first, second] = chips();
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });
});
