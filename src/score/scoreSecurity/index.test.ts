import { describe, it, expect } from "vitest";
import scoreSecurity from "./index.js";
import type { FetchResult, NpmPackument, OsvVulnerability } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makePackument(overrides: Partial<NpmPackument> = {}): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: { created: "2020-01-01T00:00:00Z", "1.0.0": "2024-01-01T00:00:00Z" },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license: "MIT",
    versions: { "1.0.0": { name: "test-pkg", version: "1.0.0" } },
    ...overrides,
  };
}

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    packument: makePackument(),
    downloads: null,
    githubRepo: null,
    githubContributors: null,
    githubCommitActivity: null,
    vulnerabilities: [],
    deprecatedDeps: [],
    ...overrides,
  };
}

function makeVuln(severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW", id = "GHSA-xxxx"): OsvVulnerability {
  return {
    id,
    modified: "2024-01-01T00:00:00Z",
    published: "2024-01-01T00:00:00Z",
    affected: [
      {
        package: { name: "test-pkg", ecosystem: "npm" },
        database_specific: { severity },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// CRITICAL CVE override
// ---------------------------------------------------------------------------

describe("scoreSecurity — CRITICAL CVE override", () => {
  it("returns score 0 when any CRITICAL CVE is present", () => {
    const result = makeFetchResult({ vulnerabilities: [makeVuln("CRITICAL")] });
    const output = scoreSecurity(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(0);
  });

  it("includes a critical warning for CRITICAL CVE", () => {
    const result = makeFetchResult({ vulnerabilities: [makeVuln("CRITICAL")] });
    const output = scoreSecurity(result);
    const criticalWarning = output!.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
  });

  it("CRITICAL CVE overrides even when mixed with lower-severity CVEs", () => {
    const result = makeFetchResult({
      vulnerabilities: [makeVuln("LOW", "GHSA-low"), makeVuln("CRITICAL", "GHSA-crit")],
    });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Severity weighting
// ---------------------------------------------------------------------------

describe("scoreSecurity — severity weighting", () => {
  it("subtracts 20 per HIGH severity CVE", () => {
    const result = makeFetchResult({ vulnerabilities: [makeVuln("HIGH")] });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(80); // 100 - 20
  });

  it("subtracts 20 per HIGH CVE cumulatively", () => {
    const result = makeFetchResult({
      vulnerabilities: [makeVuln("HIGH", "GHSA-1"), makeVuln("HIGH", "GHSA-2")],
    });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(60); // 100 - 20 - 20
  });

  it("subtracts 10 per MODERATE severity CVE", () => {
    const result = makeFetchResult({ vulnerabilities: [makeVuln("MODERATE")] });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(90); // 100 - 10
  });

  it("subtracts 3 per LOW severity CVE", () => {
    const result = makeFetchResult({ vulnerabilities: [makeVuln("LOW")] });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(97); // 100 - 3
  });

  it("does not let score go below 0 from penalty accumulation", () => {
    const vulns = Array.from({ length: 10 }, (_, i) => makeVuln("HIGH", `GHSA-${i}`));
    const result = makeFetchResult({ vulnerabilities: vulns });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Clean package
// ---------------------------------------------------------------------------

describe("scoreSecurity — clean package", () => {
  it("returns score 100 when there are no CVEs and no deprecated deps", () => {
    const result = makeFetchResult({ vulnerabilities: [], deprecatedDeps: [] });
    const output = scoreSecurity(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(100);
  });

  it("includes a 'No known CVEs' detail line for clean packages", () => {
    const result = makeFetchResult({ vulnerabilities: [], deprecatedDeps: [] });
    const output = scoreSecurity(result);
    expect(output!.details.join(" ")).toMatch(/no known cves/i);
  });

  it("has no warnings for a clean package", () => {
    const result = makeFetchResult({ vulnerabilities: [], deprecatedDeps: [] });
    const output = scoreSecurity(result);
    expect(output!.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dependency CVE penalties (deprecated deps)
// ---------------------------------------------------------------------------

describe("scoreSecurity — deprecated dependency penalties", () => {
  it("subtracts 5 per deprecated direct dependency", () => {
    const result = makeFetchResult({
      vulnerabilities: [],
      deprecatedDeps: [{ name: "old-dep", deprecated: "Use new-dep instead" }],
    });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(95); // 100 - 5
  });

  it("subtracts 5 per deprecated dep cumulatively", () => {
    const result = makeFetchResult({
      vulnerabilities: [],
      deprecatedDeps: [
        { name: "dep-a", deprecated: "deprecated" },
        { name: "dep-b", deprecated: "deprecated" },
        { name: "dep-c", deprecated: "deprecated" },
      ],
    });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(85); // 100 - 15
  });

  it("adds a warning for deprecated dependencies", () => {
    const result = makeFetchResult({
      vulnerabilities: [],
      deprecatedDeps: [{ name: "old-dep", deprecated: "deprecated" }],
    });
    const output = scoreSecurity(result);
    const depWarning = output!.warnings.find((w) => w.message.toLowerCase().includes("deprecated"));
    expect(depWarning).toBeDefined();
  });

  it("does not apply deprecated dep penalty when CRITICAL CVE already zeros the score", () => {
    const result = makeFetchResult({
      vulnerabilities: [makeVuln("CRITICAL")],
      deprecatedDeps: [{ name: "old-dep", deprecated: "Use new-dep" }],
    });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Null return
// ---------------------------------------------------------------------------

describe("scoreSecurity — returns null", () => {
  it("returns null when both vulnerabilities and deprecatedDeps are null", () => {
    const result = makeFetchResult({ vulnerabilities: null, deprecatedDeps: null });
    const output = scoreSecurity(result);
    expect(output).toBeNull();
  });

  it("returns a result when vulnerabilities are null but deprecatedDeps are available", () => {
    const result = makeFetchResult({
      vulnerabilities: null,
      deprecatedDeps: [],
    });
    const output = scoreSecurity(result);
    expect(output).not.toBeNull();
  });

  it("returns a result when deprecatedDeps are null but vulnerabilities are available", () => {
    const result = makeFetchResult({
      vulnerabilities: [],
      deprecatedDeps: null,
    });
    const output = scoreSecurity(result);
    expect(output).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Severity fallback (CVSS numeric score)
// ---------------------------------------------------------------------------

describe("scoreSecurity — CVSS numeric fallback", () => {
  it("treats CVSS >= 9.0 as CRITICAL and overrides score to 0", () => {
    const vuln: OsvVulnerability = {
      id: "GHSA-cvss",
      modified: "2024-01-01T00:00:00Z",
      published: "2024-01-01T00:00:00Z",
      affected: [{ package: { name: "test-pkg", ecosystem: "npm" } }],
      severity: [{ type: "CVSS_V3", score: "9.5" }],
    };
    const result = makeFetchResult({ vulnerabilities: [vuln] });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(0);
  });

  it("treats CVSS >= 7.0 as HIGH and subtracts 20", () => {
    const vuln: OsvVulnerability = {
      id: "GHSA-cvss-high",
      modified: "2024-01-01T00:00:00Z",
      published: "2024-01-01T00:00:00Z",
      affected: [{ package: { name: "test-pkg", ecosystem: "npm" } }],
      severity: [{ type: "CVSS_V3", score: "7.5" }],
    };
    const result = makeFetchResult({ vulnerabilities: [vuln] });
    const output = scoreSecurity(result);
    expect(output!.score).toBe(80);
  });
});
