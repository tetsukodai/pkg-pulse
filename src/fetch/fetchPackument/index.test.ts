import { describe, it, expect, vi, afterEach } from "vitest";
import fetchPackument from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal fake Response object for vi.stubGlobal fetch mocking. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Successful fetch
// ---------------------------------------------------------------------------

describe("fetchPackument — successful fetch", () => {
  it("returns the parsed JSON body on a 200 response", async () => {
    const packument = {
      name: "lodash",
      "dist-tags": { latest: "4.17.21" },
      time: { created: "2012-04-23T00:00:00Z", modified: "2024-01-01T00:00:00Z" },
      maintainers: [{ name: "jdalton", email: "john@example.com" }],
      versions: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(packument)));

    const result = await fetchPackument("lodash");

    expect(result).toEqual(packument);
  });

  it("calls the registry URL with the Accept: application/json header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse({ name: "lodash", versions: {} }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchPackument("lodash");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://registry.npmjs.org/lodash");
    expect((init.headers as Record<string, string>)["Accept"]).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// 404 — hard failure
// ---------------------------------------------------------------------------

describe("fetchPackument — 404 throws", () => {
  it("throws an error containing the package name when the registry returns 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 404)));

    await expect(fetchPackument("does-not-exist")).rejects.toThrow("does-not-exist");
  });

  it("the 404 error message mentions 'Package not found'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 404)));

    await expect(fetchPackument("does-not-exist")).rejects.toThrow(/package not found/i);
  });
});

// ---------------------------------------------------------------------------
// Non-404 HTTP errors
// ---------------------------------------------------------------------------

describe("fetchPackument — non-404 HTTP errors", () => {
  it("throws on a 500 response with the HTTP status in the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 500)));

    await expect(fetchPackument("some-pkg")).rejects.toThrow("500");
  });
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe("fetchPackument — network errors", () => {
  it("throws a network error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchPackument("lodash")).rejects.toThrow(/network error/i);
  });

  it("includes the package name in the network error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connect ECONNREFUSED")));

    await expect(fetchPackument("lodash")).rejects.toThrow("lodash");
  });
});

// ---------------------------------------------------------------------------
// Scoped package URL encoding
// ---------------------------------------------------------------------------

describe("fetchPackument — scoped package URL encoding", () => {
  it("encodes @scope/name to %40scope%2Fname in the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse({ name: "@babel/core", versions: {} }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchPackument("@babel/core");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://registry.npmjs.org/%40babel%2Fcore");
  });

  it("does not encode unscoped package names", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse({ name: "express", versions: {} }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchPackument("express");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://registry.npmjs.org/express");
  });

  it("handles a deeply scoped name like @scope/sub-pkg correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ name: "@types/node", versions: {} }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchPackument("@types/node");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://registry.npmjs.org/%40types%2Fnode");
  });
});
