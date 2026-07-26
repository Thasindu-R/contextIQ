// Unit tests for the fetch wrapper's error handling.
// Single responsibility: exercise how non-2xx responses become ApiErrors.
// The wrapper is private, so it's driven through the exported functions.

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, deleteDocument, listDocuments, uploadDocument } from "@/api/client";

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
