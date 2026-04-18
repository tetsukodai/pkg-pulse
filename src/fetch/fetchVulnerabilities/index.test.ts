import { describe, it, expect, vi, afterEach } from "vitest";
import fetchVulnerabilities, { fetchVulnerabilitiesBatch } from "./index.js";
import type { OsvVulnerability } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

function makeVuln(id: string, severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW"): OsvVulnerability {
  return {
    id,
    modified: "2024-01-01T00:00:00Z",
    published: "2024-01-01T00:00:00Z",
    summary: `${severity} vulnerability`,
    affected: [
      {
        package: { name: "test-pkg", ecosystem: "npm" },
        database_specific: { severity },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// fetchVulnerabilities — single package query
// ---------------------------------------------------------------------------

describe("fetchVulnerabilities — OSV response parsing", () => {
  it("returns an array of vulnerabilities when the API reports findings", async () => {
    const vuln = makeVuln("GHSA-xxxx-yyyy-zzzz", "HIGH");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ vulns: [vuln] })));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toHaveLength(1);
    expect(result![0].id).toBe("GHSA-xxxx-yyyy-zzzz");
  });

  it("returns an empty array when the API reports no findings (vulns field absent)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({})));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toEqual([]);
  });

  it("returns an empty array when the API returns an empty vulns array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ vulns: [] })));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toEqual([]);
  });

  it("POSTs to the correct OSV endpoint with package name, ecosystem, and version", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse({ vulns: [] }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchVulnerabilities("express", "4.18.2");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.osv.dev/v1/query");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toEqual({
      package: { name: "express", ecosystem: "npm" },
      version: "4.18.2",
    });
  });

  it("preserves multiple vulnerability records from the response", async () => {
    const vulns = [
      makeVuln("GHSA-aaaa", "HIGH"),
      makeVuln("GHSA-bbbb", "MODERATE"),
      makeVuln("GHSA-cccc", "CRITICAL"),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ vulns })));

    const result = await fetchVulnerabilities("test-pkg", "2.0.0");

    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// fetchVulnerabilities — network error returns null
// ---------------------------------------------------------------------------

describe("fetchVulnerabilities — network error returns null", () => {
  it("returns null when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toBeNull();
  });

  it("returns null when the OSV API returns a non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 503)));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toBeNull();
  });

  it("returns null on a 429 (rate-limited) response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 429)));

    const result = await fetchVulnerabilities("test-pkg", "1.0.0");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchVulnerabilitiesBatch — batch query
// ---------------------------------------------------------------------------

describe("fetchVulnerabilitiesBatch — OSV batch query", () => {
  it("returns an empty Map when queries array is empty", async () => {
    // fetch should not be called — short-circuit on empty input
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchVulnerabilitiesBatch([]);

    expect(result).toBeInstanceOf(Map);
    expect(result!.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns a Map keyed by packageName@version with vulns arrays", async () => {
    const vuln = makeVuln("GHSA-dep-vuln", "HIGH");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse({
          results: [{ vulns: [vuln] }, { vulns: [] }],
        }),
      ),
    );

    const result = await fetchVulnerabilitiesBatch([
      { name: "lodash", version: "4.17.20" },
      { name: "express", version: "4.17.1" },
    ]);

    expect(result).not.toBeNull();
    expect(result!.get("lodash@4.17.20")).toHaveLength(1);
    expect(result!.get("express@4.17.1")).toHaveLength(0);
  });

  it("maps entries with missing vulns field to empty arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse({
          results: [{}], // no vulns key
        }),
      ),
    );

    const result = await fetchVulnerabilitiesBatch([{ name: "some-pkg", version: "1.0.0" }]);

    expect(result!.get("some-pkg@1.0.0")).toEqual([]);
  });

  it("returns null when the batch fetch fails with a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await fetchVulnerabilitiesBatch([{ name: "lodash", version: "4.17.20" }]);

    expect(result).toBeNull();
  });

  it("returns null when the batch API returns a non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(null, 500)));

    const result = await fetchVulnerabilitiesBatch([{ name: "lodash", version: "4.17.20" }]);

    expect(result).toBeNull();
  });
});
