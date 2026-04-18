import { describe, it, expect } from "vitest";
import scoreCommunity from "./index.js";
import type { FetchResult, GithubContributorStat, NpmDownloads, NpmPackument } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makePackument(): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: { "1.0.0": "2024-01-01T00:00:00Z" },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license: "MIT",
    versions: { "1.0.0": { name: "test-pkg", version: "1.0.0" } },
  };
}

function makeDownloads(lastWeek: number, lastMonth: number): { lastWeek: NpmDownloads; lastMonth: NpmDownloads } {
  return {
    lastWeek: { downloads: lastWeek, start: "2024-01-01", end: "2024-01-07", package: "test-pkg" },
    lastMonth: { downloads: lastMonth, start: "2023-12-01", end: "2023-12-31", package: "test-pkg" },
  };
}

function makeContributors(count: number): GithubContributorStat[] {
  return Array.from({ length: count }, (_, i) => ({
    total: 100,
    weeks: [],
    author: { login: `user${i}`, avatar_url: "" },
  }));
}

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    packument: makePackument(),
    downloads: makeDownloads(10_000, 40_000), // flat trend
    githubRepo: {
      archived: false,
      pushed_at: "2024-01-01T00:00:00Z",
      open_issues_count: 5,
      stargazers_count: 500,
      license: null,
      default_branch: "main",
    },
    githubContributors: makeContributors(10),
    githubCommitActivity: null,
    vulnerabilities: null,
    deprecatedDeps: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Download trend computation
// ---------------------------------------------------------------------------

describe("scoreCommunity — download trend computation", () => {
  it("scores higher when last-week downloads show strong growth vs last-month average", () => {
    // lastWeek = 20_000, lastMonth/4 = 10_000 → trendRatio = 2.0 → max score
    const result = makeFetchResult({ downloads: makeDownloads(20_000, 40_000) });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    // Trend score near 100 (capped) → blended score is high
    expect(output!.score).toBeGreaterThan(70);
  });

  it("scores lower when last-week downloads are declining vs last-month average", () => {
    // lastWeek = 2_000, lastMonth/4 = 10_000 → trendRatio = 0.2 → low trend score
    const result = makeFetchResult({ downloads: makeDownloads(2_000, 40_000) });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBeLessThan(60);
  });

  it("includes trend percentage in the detail string for growth", () => {
    // trendRatio = 1.5 → 50% growth
    const result = makeFetchResult({ downloads: makeDownloads(15_000, 40_000) });
    const output = scoreCommunity(result);
    const detail = output!.details.find((d) => d.includes("%"));
    expect(detail).toBeDefined();
    expect(detail).toMatch(/\+/); // positive trend
  });

  it("includes negative trend percentage in the detail string for decline", () => {
    const result = makeFetchResult({ downloads: makeDownloads(5_000, 40_000) });
    const output = scoreCommunity(result);
    const detail = output!.details.find((d) => d.includes("%"));
    expect(detail).toBeDefined();
    expect(detail).toMatch(/-\d+%/); // negative trend
  });

  it("adds a warning when download trend is declining by more than 20%", () => {
    // trendRatio = 0.6 → -40% trend
    const result = makeFetchResult({ downloads: makeDownloads(6_000, 40_000) });
    const output = scoreCommunity(result);
    const warning = output!.warnings.find((w) => w.message.toLowerCase().includes("declining"));
    expect(warning).toBeDefined();
  });

  it("does not add a decline warning for a small decline (< 20%)", () => {
    // trendRatio ≈ 0.9 → -10% trend
    const result = makeFetchResult({ downloads: makeDownloads(9_000, 40_000) });
    const output = scoreCommunity(result);
    const warning = output!.warnings.find((w) => w.message.toLowerCase().includes("declining"));
    expect(warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Raw count capping
// ---------------------------------------------------------------------------

describe("scoreCommunity — raw count sub-score", () => {
  it("scores raw count tier at 100 for ≥ 1M weekly downloads", () => {
    // With 1M+ downloads and flat trend, raw count sub-score should be 100
    const result = makeFetchResult({
      downloads: makeDownloads(1_000_000, 4_000_000),
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    // trendRatio = 1.0 → trendScore = 50; rawScore = 100; stars = 50 (neutral); diversity = 50 (neutral)
    // blended = 50*0.5 + 100*0.2 + 50*0.15 + 50*0.15 = 25 + 20 + 7.5 + 7.5 = 60
    expect(output!.score).toBe(60);
  });

  it("scores raw count tier at 20 for < 100 weekly downloads", () => {
    const result = makeFetchResult({
      downloads: makeDownloads(50, 200),
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    // trendRatio = 1.0 → trendScore = 50; rawScore = 5 (< 100 downloads); neutral for stars/diversity
    // blended = 50*0.5 + 5*0.2 + 50*0.15 + 50*0.15 = 25 + 1 + 7.5 + 7.5 = 41
    expect(output!.score).toBe(41);
  });
});

// ---------------------------------------------------------------------------
// Zero downloads edge case
// ---------------------------------------------------------------------------

describe("scoreCommunity — zero downloads edge case", () => {
  it("handles zero last-month downloads without dividing by zero", () => {
    const result = makeFetchResult({
      downloads: makeDownloads(0, 0),
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    // scoreTrend returns {score: 50, trendPct: 0} when lastMonth === 0
    // rawScore for 0 downloads → 5 (< 100 tier)
    // blended = 50*0.5 + 5*0.2 + 50*0.15 + 50*0.15 = 41
    expect(output!.score).toBe(41);
  });

  it("does not throw on zero last-week downloads with non-zero last-month", () => {
    const result = makeFetchResult({
      downloads: makeDownloads(0, 40_000),
      githubRepo: null,
      githubContributors: null,
    });
    expect(() => scoreCommunity(result)).not.toThrow();
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBeGreaterThanOrEqual(0);
    expect(output!.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Null return
// ---------------------------------------------------------------------------

describe("scoreCommunity — returns null", () => {
  it("returns null when downloads, githubRepo, and githubContributors are all null", () => {
    const result = makeFetchResult({
      downloads: null,
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).toBeNull();
  });

  it("returns a result when only downloads are available", () => {
    const result = makeFetchResult({
      downloads: makeDownloads(10_000, 40_000),
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
  });

  it("returns a result when only githubRepo is available", () => {
    const result = makeFetchResult({
      downloads: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GitHub signals
// ---------------------------------------------------------------------------

describe("scoreCommunity — GitHub star and contributor signals", () => {
  it("includes star count in the detail string when githubRepo is available", () => {
    const result = makeFetchResult();
    const output = scoreCommunity(result);
    const starDetail = output!.details.find((d) => d.toLowerCase().includes("stars"));
    expect(starDetail).toBeDefined();
  });

  it("includes contributor count in the detail string when githubContributors is available", () => {
    const result = makeFetchResult({ githubContributors: makeContributors(15) });
    const output = scoreCommunity(result);
    const contributorDetail = output!.details.find((d) => d.toLowerCase().includes("contributor"));
    expect(contributorDetail).toBeDefined();
  });

  it("uses neutral defaults for missing GitHub data rather than penalizing", () => {
    // With downloads but no GitHub data, score should not be near 0
    const result = makeFetchResult({
      downloads: makeDownloads(10_000, 40_000),
      githubRepo: null,
      githubContributors: null,
    });
    const output = scoreCommunity(result);
    expect(output!.score).toBeGreaterThan(20);
  });
});
