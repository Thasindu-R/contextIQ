// Tests for the chat reducer: how a stream of frames becomes message
// state, and how the two "no answer" outcomes stay distinct.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "@/hooks/useChat";
import type { AnswerStreamEvent } from "@/api/client";
import type { RetrievalMode, SourceOut } from "@/types";

const api = vi.hoisted(() => ({
  askQuestion: vi.fn(),
}));

// ApiError is re-declared rather than imported, since the module it lives
// in is the one being mocked.
vi.mock("@/api/client", () => ({
  askQuestion: api.askQuestion,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
    }
  },
}));

/** A retrieved chunk already joined with its citation, as the `done`
 *  frame sends it. */
function citation(document: string): SourceOut {
  return {
    chunk_id: `chunk-${document}`,
    document_id: "doc-1",
    document,
    page: 3,
    snippet: "Renews annually.",
    text: "Renews annually.",
    score: 0.0164,
    source: "both",
    semantic_rank: 1,
    keyword_rank: 2,
  };
}

function doneFrame(mode: RetrievalMode | null, sources: SourceOut[]): AnswerStreamEvent {
  return { type: "done", sources, retrieval_mode: mode };
}

/** A stream that emits `frames` in order, with no suspension points. */
function streamOf(frames: AnswerStreamEvent[]) {
  return async function* () {
    for (const frame of frames) {
      yield frame;
    }
  };
}

/**
 * A stream that rejects on its first frame -- a generation failure before
 * any token arrived. Hand-rolling the iterator rather than using a
 * generator, because a generator that only throws has no `yield`.
 */
function failingStream(message: string) {
  return () => ({
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(new Error(message)),
  });
}

/** A promise plus its resolver, for holding a stream open mid-answer. */
function gate() {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

beforeEach(() => {
  api.askQuestion.mockImplementation(
    streamOf([
      { type: "token", text: "Renews annually [1]." },
      doneFrame("hybrid", [citation("a.pdf")]),
    ]),
  );
});

describe("asking a question", () => {
  it("appends the question and a pending answer straight away", async () => {
    const { result } = renderHook(() => useChat());

    act(() => result.current.ask("When does it renew?"));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "When does it renew?",
      status: "complete",
    });
    // Pending, not streaming: nothing has come back yet, so the UI shows
    // a typing indicator rather than an empty bubble.
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", status: "pending" });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("ignores an empty or whitespace-only question", () => {
    const { result } = renderHook(() => useChat());

    act(() => result.current.ask("   "));

    expect(result.current.messages).toHaveLength(0);
    expect(api.askQuestion).not.toHaveBeenCalled();
  });

  it("sends the selected document ids, and null when nothing is selected", async () => {
    const { result } = renderHook(() => useChat());

    act(() => result.current.ask("Q1", { documentIds: ["doc-a", "doc-b"] }));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(api.askQuestion.mock.calls[0][0]).toMatchObject({
      question: "Q1",
      document_ids: ["doc-a", "doc-b"],
    });

    act(() => result.current.ask("Q2"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    // An empty selection means "search everything", which the backend
    // spells as null rather than an empty array.
    expect(api.askQuestion.mock.calls[1][0]).toMatchObject({ question: "Q2", document_ids: null });
  });
});

describe("consuming the answer stream", () => {
  it("renders tokens incrementally as they arrive", async () => {
    const held = gate();
    api.askQuestion.mockImplementation(async function* () {
      yield { type: "token", text: "Renews " };
      await held.opened;
      yield { type: "token", text: "annually [1]." };
      yield doneFrame("hybrid", [citation("a.pdf")]);
    });

    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("When does it renew?"));

    // Mid-stream: the first token is on screen and the turn is streaming,
    // not complete -- which is what makes real SSE a drop-in later.
    await waitFor(() => expect(result.current.messages[1].content).toBe("Renews "));
    expect(result.current.messages[1].status).toBe("streaming");
    expect(result.current.messages[1].sources).toBeUndefined();
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      held.open();
    });

    await waitFor(() => expect(result.current.messages[1].status).toBe("complete"));
    expect(result.current.messages[1].content).toBe("Renews annually [1].");
  });

  it("attaches sources and the retrieval mode from the done frame", async () => {
    const { result } = renderHook(() => useChat());

    act(() => result.current.ask("When does it renew?"));
    await waitFor(() => expect(result.current.messages[1].status).toBe("complete"));

    expect(result.current.messages[1]).toMatchObject({
      content: "Renews annually [1].",
      retrievalMode: "hybrid",
    });
    expect(result.current.messages[1].sources).toHaveLength(1);
    // Chunk and citation arrive pre-joined -- there is no second array.
    expect(result.current.messages[1].sources?.[0].document).toBe("a.pdf");
    expect(result.current.messages[1].sources?.[0].source).toBe("both");
  });
});

describe("the two ways an answer can carry no sources", () => {
  it("treats empty retrieval as an ordinary completed answer", async () => {
    const refusal = "I cannot answer this question based on the available documents.";
    api.askQuestion.mockImplementation(
      streamOf([{ type: "token", text: refusal }, doneFrame(null, [])]),
    );

    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("Anything?"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    const answer = result.current.messages[1];
    expect(answer.status).toBe("complete");
    expect(answer.status).not.toBe("error");
    expect(answer.content).toBe(refusal);
    expect(answer.sources).toEqual([]);
    expect(answer.retrievalMode).toBeNull();
    expect(answer.error).toBeUndefined();
  });

  it("marks the turn as failed when the stream throws an error frame", async () => {
    api.askQuestion.mockImplementation(async function* () {
      yield { type: "token", text: "partial" };
      throw new Error("Claude API request failed after retries.");
    });

    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("Anything?"));
    await waitFor(() => expect(result.current.messages[1].status).toBe("error"));

    expect(result.current.messages[1].error).toBe("Claude API request failed after retries.");
    expect(result.current.isStreaming).toBe(false);
  });
});

describe("regenerate", () => {
  it("replays the same request and clears the previous outcome", async () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("When does it renew?", { documentIds: ["doc-a"] }));
    await waitFor(() => expect(result.current.messages[1].status).toBe("complete"));

    const answerId = result.current.messages[1].id;
    const held = gate();
    api.askQuestion.mockImplementation(async function* () {
      await held.opened;
      yield { type: "token", text: "Second answer." };
      yield doneFrame("semantic", [citation("b.pdf")]);
    });

    act(() => result.current.regenerate(answerId));

    // Reset to pending rather than left holding the stale answer.
    await waitFor(() => expect(result.current.messages[1].status).toBe("pending"));
    expect(result.current.messages[1].content).toBe("");
    expect(result.current.messages[1].sources).toBeUndefined();

    await act(async () => {
      held.open();
    });
    await waitFor(() => expect(result.current.messages[1].status).toBe("complete"));

    expect(result.current.messages[1].content).toBe("Second answer.");
    expect(result.current.messages).toHaveLength(2);
    // Same request, replayed verbatim -- including the document scope.
    expect(api.askQuestion.mock.calls[1][0]).toMatchObject({
      question: "When does it renew?",
      document_ids: ["doc-a"],
    });
  });

  it("retries a failed turn back into a good answer", async () => {
    api.askQuestion.mockImplementation(failingStream("Claude API request failed after retries."));

    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("When does it renew?"));
    await waitFor(() => expect(result.current.messages[1].status).toBe("error"));

    api.askQuestion.mockImplementation(
      streamOf([{ type: "token", text: "Recovered." }, doneFrame("hybrid", [citation("a.pdf")])]),
    );
    act(() => result.current.regenerate(result.current.messages[1].id));

    await waitFor(() => expect(result.current.messages[1].status).toBe("complete"));
    expect(result.current.messages[1].content).toBe("Recovered.");
    expect(result.current.messages[1].error).toBeUndefined();
  });
});

describe("citation highlighting", () => {
  it("falls back to the pinned source when a hover ends", async () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("When does it renew?"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    const messageId = result.current.messages[1].id;

    act(() => result.current.selectCitation({ messageId, sourceIndex: 0 }));
    expect(result.current.pinnedCitation).toEqual({ messageId, sourceIndex: 0 });

    act(() => result.current.hoverCitation({ messageId, sourceIndex: 1 }));
    expect(result.current.activeCitation).toEqual({ messageId, sourceIndex: 1 });

    act(() => result.current.hoverCitation(null));
    // Back to the pinned one, not to nothing.
    expect(result.current.activeCitation).toEqual({ messageId, sourceIndex: 0 });
  });

  it("unpins when the pinned source is clicked again", async () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.ask("When does it renew?"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    const messageId = result.current.messages[1].id;
    const citationRef = { messageId, sourceIndex: 0 };

    act(() => result.current.selectCitation(citationRef));
    act(() => result.current.selectCitation(citationRef));

    expect(result.current.pinnedCitation).toBeNull();
    act(() => result.current.hoverCitation(null));
    expect(result.current.activeCitation).toBeNull();
  });
});
