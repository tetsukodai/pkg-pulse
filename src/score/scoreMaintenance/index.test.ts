import { describe, it, expect } from "vitest";
import scoreMaintenance from "./index.js";
import type { FetchResult, GithubContributorStat, NpmPackument } from "@/types/index.js";

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
      "1.0.0": new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
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
    downloads: null,
    githubRepo: null,
    githubContributors: null,
    githubCommitActivity: null,
    vulnerabilities: null,
    deprecatedDeps: null,
    ...overrides,
  };
}

/**
 * Builds a packument with a publish timestamp exactly `days` days ago.
 * Deliberately omits the test script and uses a short readme to prevent
 * the "finished project" exception from intercepting the recency decay tests.
 */
function withPublishDaysAgo(days: number): NpmPackument {
  const ts = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return makePackument({
    time: { created: "2020-01-01T00:00:00Z", modified: ts, "1.0.0": ts },
    // Short readme and no test script → finished-project exception does not apply
    readme: "short",
    versions: {
      "1.0.0": {
        name: "test-pkg",
        version: "1.0.0",
        scripts: {}, // no test script
        readme: "short",
      },
    },
  });
}

/** Builds a contributor array where one author dominates (bus factor = 1). */
function makeContributorsBusFactor1(): GithubContributorStat[] {
  return [
    { total: 900, weeks: [], author: { login: "alice", avatar_url: "" } },
    { total: 50, weeks: [], author: { login: "bob", avatar_url: "" } },
    { total: 50, weeks: [], author: { login: "carol", avatar_url: "" } },
  ];
}

/**
 * Builds contributors where bus factor ≥ 4 (scores 100).
 * 10 equal contributors at 100 commits each = 1000 total, threshold 500.
 * computeBusFactor returns 5 (first 5 = 500 = 50%) → scoreBusFactor(5) = 100.
 */
function makeContributorsBusFactor4(): GithubContributorStat[] {
  return Array.from({ length: 10 }, (_, i) => ({
    total: 100,
    weeks: [],
    author: { login: `user${i}`, avatar_url: "" },
  }));
}

// ---------------------------------------------------------------------------
// Recency decay curve — threshold boundaries
// ---------------------------------------------------------------------------

describe("scoreMaintenance — publish recency decay curve", () => {
  it("scores 100 for a package published 0 days ago", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(0) });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(100);
  });

  it("scores 100 at the 90-day boundary (inclusive)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(90) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(100);
  });

  it("scores 75 just past the 90-day boundary (91 days)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(91) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(75);
  });

  it("scores 75 at the 180-day boundary (inclusive)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(180) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(75);
  });

  it("scores 50 just past the 180-day boundary (181 days)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(181) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(50);
  });

  it("scores 50 at the 365-day boundary (inclusive)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(365) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(50);
  });

  it("scores 25 just past the 365-day boundary (366 days)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(366) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(25);
  });

  it("scores 25 at the 730-day boundary (inclusive)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(730) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(25);
  });

  it("scores 0 past the 730-day boundary (731+ days)", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(731) });
    const output = scoreMaintenance(result);
    expect(output!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bus factor scoring
// ---------------------------------------------------------------------------

describe("scoreMaintenance — bus factor", () => {
  it("penalizes a bus factor of 1 (single contributor dominates)", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubContributors: makeContributorsBusFactor1(),
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    // Score is blended: recency (100) * 0.6 + busScore (20) * 0.4 = 68
    expect(output!.score).toBe(68);
  });

  it("adds a warning for bus factor of 1", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubContributors: makeContributorsBusFactor1(),
    });
    const output = scoreMaintenance(result);
    const busWarning = output!.warnings.find((w) =>
      w.message.toLowerCase().includes("bus factor"),
    );
    expect(busWarning).toBeDefined();
    expect(busWarning!.severity).toBe("warning");
  });

  it("scores higher when bus factor is 4 or more", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubContributors: makeContributorsBusFactor4(),
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    // recency (100) * 0.6 + busScore (100) * 0.4 = 100
    expect(output!.score).toBe(100);
  });

  it("does not blend bus factor when contributor data is absent", () => {
    const result = makeFetchResult({ packument: withPublishDaysAgo(30), githubContributors: null });
    const output = scoreMaintenance(result);
    // No bus factor blend — score equals recency score only
    expect(output!.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Deprecation override
// ---------------------------------------------------------------------------

describe("scoreMaintenance — deprecation override", () => {
  it("returns score 0 when the latest version is deprecated", () => {
    const packument = makePackument({
      versions: {
        "1.0.0": {
          name: "test-pkg",
          version: "1.0.0",
          deprecated: "Use other-pkg instead",
        },
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(0);
  });

  it("includes a critical warning when deprecated", () => {
    const packument = makePackument({
      versions: {
        "1.0.0": {
          name: "test-pkg",
          version: "1.0.0",
          deprecated: "Use other-pkg instead",
        },
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    const criticalWarning = output!.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
    expect(criticalWarning!.message).toMatch(/deprecated/i);
  });

  it("includes a human-readable publish recency in details when deprecated", () => {
    const packument = makePackument({
      versions: {
        "1.0.0": {
          name: "test-pkg",
          version: "1.0.0",
          deprecated: "Use other-pkg instead",
        },
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.details.some((d) => /days ago/.test(d))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Archived override
// ---------------------------------------------------------------------------

describe("scoreMaintenance — archived override", () => {
  it("returns score 0 when the GitHub repo is archived", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubRepo: {
        archived: true,
        pushed_at: "2020-01-01T00:00:00Z",
        open_issues_count: 2,
        stargazers_count: 100,
        license: null,
        default_branch: "main",
      },
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(0);
  });

  it("includes a critical warning for archived repos", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubRepo: {
        archived: true,
        pushed_at: "2020-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 0,
        license: null,
        default_branch: "main",
      },
    });
    const output = scoreMaintenance(result);
    const criticalWarning = output!.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
    expect(criticalWarning!.message).toMatch(/archived/i);
  });

  it("includes a human-readable publish recency in details when archived", () => {
    const result = makeFetchResult({
      packument: withPublishDaysAgo(30),
      githubRepo: {
        archived: true,
        pushed_at: "2020-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 0,
        license: null,
        default_branch: "main",
      },
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.details.some((d) => /days ago/.test(d))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finished project exception
// ---------------------------------------------------------------------------

describe("scoreMaintenance — finished project exception", () => {
  it("applies maintenance floor of 90 for a finished project regardless of publish recency", () => {
    // A 3-year old package that meets all finished-project criteria
    const packument = makePackument({
      "dist-tags": { latest: "1.0.0" },
      time: {
        created: "2015-01-01T00:00:00Z",
        modified: "2021-01-01T00:00:00Z",
        "1.0.0": new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString(), // >3 years ago
      },
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
    });
    const result = makeFetchResult({
      packument,
      githubRepo: {
        archived: false,
        pushed_at: "2021-01-01T00:00:00Z",
        open_issues_count: 5, // < 15
        stargazers_count: 200,
        license: null,
        default_branch: "main",
      },
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(90);
  });

  it("does not apply finished-project floor for a package with 15+ open issues", () => {
    const packument = makePackument({
      "dist-tags": { latest: "1.0.0" },
      time: {
        created: "2015-01-01T00:00:00Z",
        modified: "2021-01-01T00:00:00Z",
        "1.0.0": new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString(),
      },
      versions: {
        "1.0.0": {
          name: "test-pkg",
          version: "1.0.0",
          scripts: { test: "vitest run" },
          readme: "A".repeat(200),
        },
      },
      readme: "A".repeat(200),
    });
    const result = makeFetchResult({
      packument,
      githubRepo: {
        archived: false,
        pushed_at: "2021-01-01T00:00:00Z",
        open_issues_count: 20, // >= 15 — exception does NOT apply
        stargazers_count: 100,
        license: null,
        default_branch: "main",
      },
    });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    // Should fall through to recency scoring: 1100 days → 0
    expect(output!.score).toBe(0);
  });

  it("does not apply finished-project floor for a package with a 0.x version", () => {
    const packument = makePackument({
      "dist-tags": { latest: "0.9.0" },
      time: {
        created: "2020-01-01T00:00:00Z",
        modified: "2022-01-01T00:00:00Z",
        "0.9.0": new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString(),
      },
      versions: {
        "0.9.0": {
          name: "test-pkg",
          version: "0.9.0",
          scripts: { test: "vitest run" },
          readme: "A".repeat(200),
        },
      },
      readme: "A".repeat(200),
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(0); // recency: 1100 days → 0
  });

  it("does not apply finished-project floor when there is no real test script", () => {
    const packument = makePackument({
      versions: {
        "1.0.0": {
          name: "test-pkg",
          version: "1.0.0",
          scripts: { test: "echo no tests" },
          readme: "A".repeat(200),
        },
      },
      time: {
        created: "2015-01-01T00:00:00Z",
        modified: "2021-01-01T00:00:00Z",
        "1.0.0": new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString(),
      },
      readme: "A".repeat(200),
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    expect(output).not.toBeNull();
    // Finished-project exception does not apply — test script starts with echo
    expect(output!.score).toBe(0);
  });
});

describe("scoreMaintenance — returns null", () => {
  it("returns null when the packument has no publish timestamp for the latest version", () => {
    const packument = makePackument({
      "dist-tags": { latest: "1.0.0" },
      time: { created: "2020-01-01T00:00:00Z", modified: "2024-01-01T00:00:00Z" }, // no "1.0.0" key
    });
    const result = makeFetchResult({ packument });
    const output = scoreMaintenance(result);
    expect(output).toBeNull();
  });
});
