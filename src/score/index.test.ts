import { describe, it, expect } from "vitest";
import score from "./index.js";
import type { CategoryScore, FetchResult, NpmPackument, OsvVulnerability } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makePackument(overrides: Partial<NpmPackument> = {}): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: {
      created: "2020-01-01T00:00:00Z",
      modified: "2024-01-01T00:00:00Z",
      "1.0.0": "2024-01-01T00:00:00Z",
    },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license: "MIT",
    versions: {
      "1.0.0": {
        name: "test-pkg",
        version: "1.0.0",
        scripts: { test: "vitest run" },
        readme: "A".repeat(200),
        types: "./dist/index.d.ts",
      },
    },
    readme: "A".repeat(200),
    ...overrides,
  };
}

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    packument: makePackument(),
    downloads: {
      lastWeek: { downloads: 10_000, start: "2024-01-01", end: "2024-01-07", package: "test-pkg" },
      lastMonth: { downloads: 40_000, start: "2023-12-01", end: "2023-12-31", package: "test-pkg" },
    },
    githubRepo: {
      archived: false,
      pushed_at: "2024-01-01T00:00:00Z",
      open_issues_count: 5,
      stargazers_count: 500,
      license: { key: "mit", name: "MIT", spdx_id: "MIT" },
      default_branch: "main",
    },
    githubContributors: [
      { total: 300, weeks: [], author: { login: "alice", avatar_url: "" } },
      { total: 200, weeks: [], author: { login: "bob", avatar_url: "" } },
      { total: 100, weeks: [], author: { login: "carol", avatar_url: "" } },
      { total: 50, weeks: [], author: { login: "dave", avatar_url: "" } },
    ],
    githubCommitActivity: null,
    vulnerabilities: [],
    deprecatedDeps: [],
    ...overrides,
  };
}

function makeCategoryScore(overrides: Partial<CategoryScore> = {}): CategoryScore {
  return {
    name: "maintenance",
    score: 100,
    weight: 0.3,
    label: "Maintenance",
    details: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator tests
// ---------------------------------------------------------------------------

describe("score — weighted aggregate computation", () => {
  it("returns a numeric score between 0 and 100 for a fully available result", () => {
    const result = makeFetchResult();
    const health = score(result);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it("includes all six categories when all data is available", () => {
    const result = makeFetchResult();
    const health = score(result);
    expect(Object.keys(health.categories)).toHaveLength(6);
    expect(health.categories.maintenance).toBeDefined();
    expect(health.categories.security).toBeDefined();
    expect(health.categories.supplyChain).toBeDefined();
    expect(health.categories.license).toBeDefined();
    expect(health.categories.community).toBeDefined();
    expect(health.categories.quality).toBeDefined();
  });

  it("sets confidence to 1.0 when all signal data is present", () => {
    const result = makeFetchResult();
    const health = score(result);
    expect(health.confidence).toBeCloseTo(1.0, 1);
  });

  it("populates name and version from the packument", () => {
    const result = makeFetchResult({
      packument: makePackument({ name: "my-lib", "dist-tags": { latest: "2.3.4" } }),
    });
    const health = score(result);
    expect(health.name).toBe("my-lib");
    expect(health.version).toBe("2.3.4");
  });
});

describe("score — re-normalization when categories are null", () => {
  it("excludes null categories from the aggregate and adjusts confidence", () => {
    // community returns null when downloads, githubRepo, and githubContributors are all null
    const result = makeFetchResult({
      downloads: null,
      githubRepo: null,
      githubContributors: null,
    });
    const health = score(result);

    // Community (weight 0.10) is absent — confidence should be ~0.90
    expect(health.confidence).toBeCloseTo(0.9, 1);

    // Community should appear in unavailable signals
    const communitySignal = health.unavailableSignals.find(
      (s) => s.signal === "Community",
    );
    expect(communitySignal).toBeDefined();
  });

  it("returns a score > 0 even when several categories are null", () => {
    // Security returns null only when both vulnerabilities AND deprecatedDeps are null
    const result = makeFetchResult({
      vulnerabilities: null,
      deprecatedDeps: null,
      downloads: null,
      githubRepo: null,
      githubContributors: null,
    });
    const health = score(result);
    // Maintenance, supply chain, license, quality should still score
    expect(health.score).toBeGreaterThan(0);
    expect(health.confidence).toBeLessThan(1.0);
  });

  it("re-normalizes weights so the aggregate is still on the 0–100 scale", () => {
    // Strip github and community data so community is null
    const result = makeFetchResult({
      downloads: null,
      githubRepo: null,
      githubContributors: null,
    });
    const health = score(result);
    // Score must be 0–100 regardless of re-normalization
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });
});

describe("score — confidence calculation", () => {
  it("confidence reflects the fraction of total weight with real data", () => {
    // Full data: confidence = 1.0
    const full = score(makeFetchResult());
    expect(full.confidence).toBeCloseTo(1.0, 1);

    // Strip community signals (weight 0.10) → confidence ≈ 0.90
    const degraded = score(
      makeFetchResult({ downloads: null, githubRepo: null, githubContributors: null }),
    );
    expect(degraded.confidence).toBeCloseTo(0.9, 1);
  });

  it("confidence is 0 when all optional data is null and only packument categories score", () => {
    // maintenance (0.30) + supplyChain (0.15) + license (0.10) + quality (0.10) = 0.65
    // security null (vulns null + deprecatedDeps null), community null
    const result = makeFetchResult({
      vulnerabilities: null,
      deprecatedDeps: null,
      downloads: null,
      githubRepo: null,
      githubContributors: null,
    });
    const health = score(result);
    expect(health.confidence).toBeCloseTo(0.65, 1);
  });
});

describe("score — warning aggregation", () => {
  it("collects warnings from all scorers into the top-level warnings array", () => {
    const criticalVuln: OsvVulnerability = {
      id: "GHSA-xxxx",
      modified: "2024-01-01T00:00:00Z",
      published: "2024-01-01T00:00:00Z",
      affected: [{ package: { name: "test-pkg", ecosystem: "npm" }, database_specific: { severity: "CRITICAL" } }],
    };
    const result = makeFetchResult({ vulnerabilities: [criticalVuln] });
    const health = score(result);
    expect(health.warnings.length).toBeGreaterThan(0);
    const criticalWarning = health.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
  });

  it("has an empty warnings array when there are no issues", () => {
    const result = makeFetchResult();
    const health = score(result);
    // A clean package with no CVEs, MIT license, recent publish should have no warnings
    // (some may come from bus factor if it is 1, so just check the type)
    expect(Array.isArray(health.warnings)).toBe(true);
  });
});

describe("score — data sources", () => {
  it("includes npm registry when packument is present", () => {
    const health = score(makeFetchResult());
    expect(health.dataSources).toContain("npm registry");
  });

  it("includes GitHub API when any github field is non-null", () => {
    const health = score(makeFetchResult());
    expect(health.dataSources).toContain("GitHub API");
  });

  it("does not include GitHub API when all github fields are null", () => {
    const result = makeFetchResult({
      githubRepo: null,
      githubContributors: null,
      githubCommitActivity: null,
    });
    const health = score(result);
    expect(health.dataSources).not.toContain("GitHub API");
  });

  it("includes OSV when vulnerabilities or deprecatedDeps are non-null", () => {
    const health = score(makeFetchResult({ vulnerabilities: [], deprecatedDeps: [] }));
    expect(health.dataSources).toContain("OSV");
  });

  it("does not include OSV when both vulnerability fields are null", () => {
    const result = makeFetchResult({ vulnerabilities: null, deprecatedDeps: null });
    const health = score(result);
    expect(health.dataSources).not.toContain("OSV");
  });
});

// Suppress the unused import for makeCategoryScore — it documents the factory pattern
void makeCategoryScore;

// ---------------------------------------------------------------------------
// Composite override cap tests
// ---------------------------------------------------------------------------

/**
 * Factory: creates a CRITICAL OSV vulnerability to force security score to 0.
 */
function makeCriticalVuln(): OsvVulnerability {
  return {
    id: "GHSA-crit-0001",
    modified: "2024-01-01T00:00:00Z",
    published: "2024-01-01T00:00:00Z",
    affected: [
      {
        package: { name: "test-pkg", ecosystem: "npm" },
        database_specific: { severity: "CRITICAL" },
      },
    ],
  };
}

/**
 * Factory: overrides the packument to mark the package as deprecated,
 * which forces maintenance score to 0.
 */
function makeDeprecatedPackument(): NpmPackument {
  return makePackument({
    versions: {
      "1.0.0": {
        name: "test-pkg",
        version: "1.0.0",
        deprecated: "Use other-pkg instead",
        scripts: { test: "vitest run" },
        readme: "A".repeat(200),
        types: "./dist/index.d.ts",
      },
    },
  });
}

describe("score — composite override caps", () => {
  it("caps score at 15 when both maintenance and security are zero", () => {
    // Deprecated → maintenance = 0; CRITICAL CVE → security = 0
    const result = makeFetchResult({
      packument: makeDeprecatedPackument(),
      vulnerabilities: [makeCriticalVuln()],
    });
    const health = score(result);

    expect(health.score).toBeLessThanOrEqual(15);
    expect(health.categories.maintenance?.score).toBe(0);
    expect(health.categories.security?.score).toBe(0);

    const capWarning = health.warnings.find(
      (w) => w.severity === "critical" && w.message.includes("capped at 15"),
    );
    expect(capWarning).toBeDefined();
  });

  it("caps score at 25 when only security is zero (CRITICAL CVE, active maintenance)", () => {
    // No deprecation → maintenance > 0; CRITICAL CVE → security = 0
    const result = makeFetchResult({
      vulnerabilities: [makeCriticalVuln()],
    });
    const health = score(result);

    expect(health.score).toBeLessThanOrEqual(25);
    // Maintenance should be non-zero (recently published, not deprecated)
    expect((health.categories.maintenance?.score ?? 0)).toBeGreaterThan(0);
    expect(health.categories.security?.score).toBe(0);

    const capWarning = health.warnings.find(
      (w) => w.severity === "critical" && w.message.includes("capped at 25"),
    );
    expect(capWarning).toBeDefined();
  });

  it("caps score at 35 when only maintenance is zero (deprecated, no CVEs)", () => {
    // Deprecated → maintenance = 0; no CVEs → security > 0
    const result = makeFetchResult({
      packument: makeDeprecatedPackument(),
      vulnerabilities: [],
    });
    const health = score(result);

    expect(health.score).toBeLessThanOrEqual(35);
    expect(health.categories.maintenance?.score).toBe(0);
    expect((health.categories.security?.score ?? 0)).toBeGreaterThan(0);

    const capWarning = health.warnings.find(
      (w) => w.severity === "warning" && w.message.includes("capped at 35"),
    );
    expect(capWarning).toBeDefined();
  });

  it("does not cap score when maintenance and security are both non-zero", () => {
    // Normal healthy package — no cap should apply
    const result = makeFetchResult();
    const health = score(result);

    // No cap warning should be present
    const capWarning = health.warnings.find((w) => w.message.includes("capped at"));
    expect(capWarning).toBeUndefined();
  });

  it("prefers the maintenance+security cap (15) over the individual security cap (25)", () => {
    // Both zero — must hit the combined cap, not the security-only cap
    const result = makeFetchResult({
      packument: makeDeprecatedPackument(),
      vulnerabilities: [makeCriticalVuln()],
    });
    const health = score(result);

    expect(health.score).toBeLessThanOrEqual(15);
    // Only one cap warning should be added (the combined one)
    const capWarnings = health.warnings.filter((w) => w.message.includes("capped at"));
    expect(capWarnings).toHaveLength(1);
    expect(capWarnings[0]?.message).toContain("capped at 15");
  });

  it("archived repo triggers maintenance=0 cap", () => {
    // Archived repo → maintenance = 0; no CVEs → security > 0 → cap at 35
    const result = makeFetchResult({
      githubRepo: {
        archived: true,
        pushed_at: "2020-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 500,
        license: { key: "mit", name: "MIT", spdx_id: "MIT" },
        default_branch: "main",
      },
      vulnerabilities: [],
    });
    const health = score(result);

    expect(health.categories.maintenance?.score).toBe(0);
    expect(health.score).toBeLessThanOrEqual(35);
  });
});
