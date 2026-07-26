// Unit tests for the fetch wrapper's error handling and the SSE parser.
// Single responsibility: exercise how non-2xx responses become ApiErrors and
// how an answer stream is decoded. Both are private, so they're driven
// through the exported functions.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskEvent } from "@/api/client";
import { ApiError, askQuestion, deleteDocument, listDocuments, uploadDocument } from "@/api/client";
import type { Source } from "@/types";

/** Stub global fetch with a single canned response. */
function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetch wrapper error handling", () => {
  it("throws an ApiError carrying the status and the server's detail", async () => {
    mockFetch(
      jsonResponse(
        { detail: "Unsupported content type: 'image/png'" },
        { status: 415, statusText: "Unsupported Media Type" },
      ),
    );

    // Asserting on the class, status and message together: the UI branches
    // on `status` and renders `message` verbatim, so both have to survive.
    // One call only -- a Response body is single-use, so calling twice
    // against the same canned response would read an already-drained body.
    const error = await listDocuments().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
    expect((error as ApiError).message).toBe("Unsupported content type: 'image/png'");
  });

  it("summarises FastAPI's validation 422, where `detail` is an array not a string", async () => {
    // The overloaded 422: this shape comes from request validation, whereas
    // an unreadable document produces a plain string detail. Naively
    // rendering this one would put "[object Object]" in front of the user.
    mockFetch(
      jsonResponse(
        {
          detail: [
            { loc: ["body", "question"], msg: "Field required", type: "missing" },
            { loc: ["body", "top_k"], msg: "Input should be a valid integer", type: "int_type" },
          ],
        },
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );

    await expect(listDocuments()).rejects.toMatchObject({
      status: 422,
      message: "Field required; Input should be a valid integer",
    });
  });

  it("falls back to the status text when the body isn't JSON at all", async () => {
    // A dev-proxy or gateway failure returns HTML. Parsing must not throw a
    // second error while handling the first.
    mockFetch(
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = await uploadDocument(new File(["hi"], "a.txt")).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toContain("502 Bad Gateway");
  });

  it("resolves without parsing a body on 204", async () => {
    // Delete returns 204 with no body; calling .json() on it would throw.
    mockFetch(new Response(null, { status: 204, statusText: "No Content" }));

    await expect(deleteDocument("6f1c8b2e-0000-4000-8000-000000000000")).resolves.toBeUndefined();
  });

  it("lets the browser set its own multipart boundary on uploads", async () => {
    // Forcing application/json here would corrupt the upload, so the
    // wrapper must leave Content-Type unset for FormData bodies.
    const fetchMock = mockFetch(jsonResponse([], { status: 201 }));

    await uploadDocument(new File(["hi"], "a.txt")).catch(() => undefined);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });
});

/** Build an SSE response whose body arrives as the given raw chunks. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("askQuestion SSE parsing", () => {
  it("yields each token in order, then a done event with mapped sources", async () => {
    mockFetch(
      sseResponse([
        frame({ type: "token", text: "Photovoltaic " }),
        frame({ type: "token", text: "cells " }),
        frame({ type: "token", text: "absorb light." }),
        frame({
          type: "done",
          retrieval_mode: "hybrid",
          sources: [
            {
              chunk_id: "c1",
              document_id: "d1",
              document: "solar.txt",
              page: 2,
              snippet: "Photovoltaic cells...",
              text: "Photovoltaic cells absorb light.",
              score: 0.03,
              source: "both",
              semantic_rank: 1,
              keyword_rank: 3,
            },
          ],
        }),
      ]),
    );

    const events: AskEvent[] = [];
    for await (const event of askQuestion("how do solar panels work?")) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual(["token", "token", "token", "done"]);
    expect(
      events
        .filter((e): e is { type: "token"; text: string } => e.type === "token")
        .map((e) => e.text)
        .join(""),
    ).toBe("Photovoltaic cells absorb light.");

    const done = events[3];
    expect(done).toMatchObject({ type: "done", mode: "hybrid" });
    // wire vocabulary is translated exactly once, here
    expect((done as { sources: Source[] }).sources[0]).toMatchObject({
      retriever: "fused",
      vector_rank: 1,
      keyword_rank: 3,
      document: "solar.txt",
    });
  });

  it("reassembles a frame split across network chunk boundaries", async () => {
    // A chunk boundary can fall anywhere, including mid-JSON. Parsing per
    // chunk instead of per `\n\n` terminator would throw a SyntaxError here.
    const whole =
      frame({ type: "token", text: "hello" }) +
      frame({ type: "done", retrieval_mode: "semantic", sources: [] });
    const split = Math.floor(whole.length / 3);

    mockFetch(sseResponse([whole.slice(0, split), whole.slice(split)]));

    const events: AskEvent[] = [];
    for await (const event of askQuestion("q")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "token", text: "hello" },
      { type: "done", sources: [], mode: "semantic" },
    ]);
  });

  it("throws on an error frame so a failed answer can't look complete", async () => {
    // The error arrives inside a 200 — the status line was sent long before
    // generation failed — so a caller that only accumulates tokens would
    // otherwise treat "partial " as the finished answer.
    mockFetch(
      sseResponse([
        frame({ type: "token", text: "partial " }),
        frame({ type: "error", message: "Claude API call failed: boom" }),
      ]),
    );

    const events: AskEvent[] = [];
    const run = async () => {
      for await (const event of askQuestion("q")) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toThrowError(ApiError);
    expect(events).toEqual([{ type: "token", text: "partial " }]);
  });

  it("surfaces a pre-stream failure as its real status code", async () => {
    // Retrieval runs before the stream opens, so its failures are ordinary
    // HTTP errors rather than error frames.
    mockFetch(jsonResponse({ detail: "database unavailable" }, { status: 503 }));

    await expect(async () => {
      for await (const _ of askQuestion("q")) {
        // no frames expected
      }
    }).rejects.toMatchObject({ status: 503, message: "database unavailable" });
  });
});
