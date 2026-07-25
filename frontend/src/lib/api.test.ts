// Unit tests for the api module's fetch wrapper.
// Single responsibility: error-handling behaviour of the wrapper. These
// mock global fetch and never touch the network.

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, deleteDocument, listDocuments } from "@/lib/api";

/** Build a Response-like object with just the surface the wrapper uses. */
function mockResponse(init: {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: string;
  json?: unknown;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? "",
    headers: new Headers({ "Content-Type": "application/json" }),
    text: async () => init.body ?? "",
    json: async () => init.json,
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetch wrapper error handling", () => {
  it("throws a typed ApiError carrying the server's detail message", async () => {
    stubFetch(
      mockResponse({
        ok: false,
        status: 415,
        statusText: "Unsupported Media Type",
        body: JSON.stringify({ detail: "Unsupported content type: 'image/png'" }),
      }),
    );

    const error = await listDocuments().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(415);
    // The server's own wording is surfaced verbatim so the UI can show it.
    expect(apiError.message).toBe("Unsupported content type: 'image/png'");
    expect(apiError.detail).toBe("Unsupported content type: 'image/png'");
  });

  it("flattens FastAPI's array-shaped validation detail into one message", async () => {
    // 422 is overloaded: extraction failures send a string detail, but
    // request-validation failures send this array shape instead.
    stubFetch(
      mockResponse({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        body: JSON.stringify({
          detail: [
            { loc: ["body", "question"], msg: "Field required", type: "missing" },
            { loc: ["body", "top_k"], msg: "Input should be a valid integer", type: "int_type" },
          ],
        }),
      }),
    );

    const error = (await listDocuments().catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toBe("Field required; Input should be a valid integer");
  });

  it("falls back to a bounded snippet when the error body is not JSON", async () => {
    // e.g. an HTML error page from a proxy sitting in front of the API.
    const html = `<html><body>${"gateway timeout ".repeat(50)}</body></html>`;
    stubFetch(mockResponse({ ok: false, status: 504, statusText: "Gateway Timeout", body: html }));

    const error = (await listDocuments().catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(504);
    expect(error.message.length).toBeLessThanOrEqual(200);
    expect(error.message).toContain("gateway timeout");
    // Nothing parseable, so there is no server-supplied detail to expose.
    expect(error.detail).toBeNull();
  });

  it("falls back to status text when the error body is empty", async () => {
    stubFetch(
      mockResponse({ ok: false, status: 500, statusText: "Internal Server Error", body: "" }),
    );

    const error = (await listDocuments().catch((caught: unknown) => caught)) as ApiError;

    expect(error.message).toBe("500 Internal Server Error");
    expect(error.detail).toBeNull();
  });

  it("resolves without parsing a body on 204 No Content", async () => {
    const response = mockResponse({ ok: true, status: 204 });
    const jsonSpy = vi.spyOn(response, "json");
    stubFetch(response);

    await expect(deleteDocument("doc-1")).resolves.toBeUndefined();
    // A 204 has no body; parsing it would throw.
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("sends JSON headers and the configured URL prefix on a normal request", async () => {
    const fetchMock = stubFetch(mockResponse({ ok: true, status: 200, json: [] }));

    await listDocuments();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/documents");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
  });
});
