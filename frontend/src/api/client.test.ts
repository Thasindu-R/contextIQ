// Tests for the SSE reader in askQuestion: frame parsing, chunk
// boundaries, and how a stream reports failure.

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, askQuestion } from "@/api/client";
import type { AnswerStreamEvent } from "@/api/client";
import type { QueryStreamFrame } from "@/types";

const encoder = new TextEncoder();

/** A Response whose body streams the given byte chunks, verbatim. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

/** Serialise frames the way the backend's route does. */
function sse(...frames: QueryStreamFrame[]): string {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/**
 * A response body can only be read once, so each call gets a freshly
 * built Response -- otherwise a test that asks twice sees an empty
 * stream the second time.
 */
function mockFetch(makeResponse: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(makeResponse())),
  );
}

async function collect(): Promise<AnswerStreamEvent[]> {
  const events: AnswerStreamEvent[] = [];
  for await (const event of askQuestion({ question: "q", document_ids: null })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("askQuestion", () => {
  it("posts the question as JSON and asks for an event stream", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([sse({ type: "done", sources: [], retrieval_mode: null })]));
    vi.stubGlobal("fetch", fetchMock);

    await collect();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/query");
    expect(init.method).toBe("POST");
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({ question: "q", document_ids: null });
  });

  it("yields token frames in order, then done", async () => {
    mockFetch(() =>
      sseResponse([
        sse(
          { type: "token", text: "Renews " },
          { type: "token", text: "annually [1]." },
          { type: "done", sources: [], retrieval_mode: "hybrid" },
        ),
      ]),
    );

    expect(await collect()).toEqual([
      { type: "token", text: "Renews " },
      { type: "token", text: "annually [1]." },
      { type: "done", sources: [], retrieval_mode: "hybrid" },
    ]);
  });

  it("reassembles a frame split across network chunks", async () => {
    // A chunk boundary can fall anywhere, including mid-JSON. Dispatching
    // per network chunk instead of per "\n\n" would throw here.
    const wire = sse(
      { type: "token", text: "hello" },
      { type: "done", sources: [], retrieval_mode: "keyword" },
    );
    const cut = Math.floor(wire.length / 3);

    mockFetch(() =>
      sseResponse([wire.slice(0, cut), wire.slice(cut, cut * 2), wire.slice(cut * 2)]),
    );

    expect(await collect()).toEqual([
      { type: "token", text: "hello" },
      { type: "done", sources: [], retrieval_mode: "keyword" },
    ]);
  });

  it("carries the pre-joined sources through the done frame", async () => {
    const source = {
      chunk_id: "c1",
      document_id: "d1",
      document: "policy.pdf",
      page: 3,
      snippet: "Renews annually.",
      text: "Renews annually.",
      score: 0.0328,
      source: "both" as const,
      semantic_rank: 1,
      keyword_rank: 1,
    };
    mockFetch(() =>
      sseResponse([sse({ type: "done", sources: [source], retrieval_mode: "hybrid" })]),
    );

    const events = await collect();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "done", sources: [source], retrieval_mode: "hybrid" });
  });

  it("throws an ApiError when the stream emits an error frame", async () => {
    // The failure arrives inside a 200 -- the status line was committed
    // before generation failed -- so only the frame reveals it.
    mockFetch(() =>
      sseResponse([
        sse(
          { type: "token", text: "partial" },
          { type: "error", message: "Claude API call failed" },
        ),
      ]),
    );

    await expect(collect()).rejects.toThrow(ApiError);
    await expect(collect()).rejects.toThrow("Claude API call failed");
  });

  it("stops at the error frame rather than reporting a finished answer", async () => {
    mockFetch(() => sseResponse([sse({ type: "error", message: "boom" })]));

    const events: AnswerStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of askQuestion({ question: "q", document_ids: null })) {
          events.push(event);
        }
      })(),
    ).rejects.toThrow("boom");
    expect(events).toEqual([]);
  });

  it("throws with the backend's detail when retrieval fails before the stream opens", async () => {
    // Retrieval runs before the response body starts, so its failures are
    // still ordinary status codes.
    mockFetch(
      () =>
        new Response(JSON.stringify({ detail: "Document is still processing" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(collect()).rejects.toMatchObject({
      status: 422,
      message: "Document is still processing",
    });
  });

  it("treats an empty-retrieval refusal as an ordinary completed answer", async () => {
    const refusal = "I cannot answer this question based on the available documents.";
    mockFetch(() =>
      sseResponse([
        sse({ type: "token", text: refusal }, { type: "done", sources: [], retrieval_mode: null }),
      ]),
    );

    const events = await collect();

    expect(events[0]).toEqual({ type: "token", text: refusal });
    expect(events[1]).toEqual({ type: "done", sources: [], retrieval_mode: null });
  });
});
