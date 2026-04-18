import { describe, it, expect } from "vitest";
import scoreQuality from "./index.js";
import type { FetchResult, NpmPackument, NpmVersionObject } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makeVersion(overrides: Partial<NpmVersionObject> = {}): NpmVersionObject {
  return {
    name: "test-pkg",
    version: "1.0.0",
    scripts: { test: "vitest run" },
    types: "./dist/index.d.ts",
    readme: "A".repeat(600),
    ...overrides,
  };
}

function makePackument(overrides: Partial<NpmPackument> = {}): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: { "1.0.0": "2024-01-01T00:00:00Z" },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license: "MIT",
    versions: { "1.0.0": makeVersion() },
    readme: "A".repeat(600),
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

// ---------------------------------------------------------------------------
// README scoring
// ---------------------------------------------------------------------------

describe("scoreQuality — README scoring", () => {
  it("scores README at 100 when readme exceeds 500 characters", () => {
    const result = makeFetchResult({
      packument: makePackument({ readme: "A".repeat(600) }),
    });
    const output = scoreQuality(result);
    expect(output).not.toBeNull();
    // readmeScore=100 * 0.4 + typesScore=100 * 0.3 + testScore=100 * 0.3 = 100
    expect(output!.score).toBe(100);
  });

  it("scores README at 50 when readme is between 100 and 500 characters", () => {
    const result = makeFetchResult({
      packument: makePackument({ readme: "A".repeat(200) }),
    });
    const output = scoreQuality(result);
    // readmeScore=50 * 0.4 = 20; typesScore=100 * 0.3 = 30; testScore=100 * 0.3 = 30 → 80
    expect(output!.score).toBe(80);
  });

  it("scores README at 0 when readme is absent", () => {
    const result = makeFetchResult({
      packument: makePackument({
        readme: undefined,
        versions: { "1.0.0": makeVersion({ readme: undefined }) },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=0 * 0.4 = 0; typesScore=100 * 0.3 = 30; testScore=100 * 0.3 = 30 → 60
    expect(output!.score).toBe(60);
  });

  it("scores README at 0 when readme is 100 characters or less", () => {
    const result = makeFetchResult({
      packument: makePackument({
        readme: "A".repeat(100),
        versions: { "1.0.0": makeVersion({ readme: "A".repeat(100) }) },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore = 0 (≤ 100 chars)
    // readmeScore=0 * 0.4 = 0; typesScore=100 * 0.3 = 30; testScore=100 * 0.3 = 30 → 60
    expect(output!.score).toBe(60);
  });

  it("adds an info warning when README is missing or too short", () => {
    const result = makeFetchResult({
      packument: makePackument({
        readme: undefined,
        versions: { "1.0.0": makeVersion({ readme: undefined }) },
      }),
    });
    const output = scoreQuality(result);
    const infoWarning = output!.warnings.find((w) => w.severity === "info");
    expect(infoWarning).toBeDefined();
    expect(infoWarning!.message.toLowerCase()).toMatch(/readme/);
  });

  it("uses the version-level readme as fallback when packument readme is absent", () => {
    const result = makeFetchResult({
      packument: makePackument({
        readme: undefined, // packument-level absent
        versions: { "1.0.0": makeVersion({ readme: "A".repeat(600) }) }, // version-level present
      }),
    });
    const output = scoreQuality(result);
    // readmeScore should be 100
    expect(output!.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// TypeScript type declarations
// ---------------------------------------------------------------------------

describe("scoreQuality — TypeScript type declarations", () => {
  it("scores types at 100 when the types field is present", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: { "1.0.0": makeVersion({ types: "./dist/index.d.ts" }) },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=100*0.4 + typesScore=100*0.3 + testScore=100*0.3 = 100
    expect(output!.score).toBe(100);
    const detail = output!.details.find((d) => d.toLowerCase().includes("typescript types bundled"));
    expect(detail).toBeDefined();
  });

  it("scores types at 100 when the typings field is present (older field)", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ types: undefined, typings: "./dist/index.d.ts" }),
        },
      }),
    });
    const output = scoreQuality(result);
    expect(output!.score).toBe(100);
  });

  it("scores types at 50 when neither types nor typings is present", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ types: undefined, typings: undefined }),
        },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=100*0.4 + typesScore=50*0.3 + testScore=100*0.3 = 40 + 15 + 30 = 85
    expect(output!.score).toBe(85);
  });

  it("includes a check suggestion for @types/ in the detail string when types are absent", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ types: undefined, typings: undefined }),
        },
      }),
    });
    const output = scoreQuality(result);
    const detail = output!.details.find((d) => d.includes("@types/"));
    expect(detail).toBeDefined();
  });

  it("generates @types/ with scoped package name mangling for scoped packages", () => {
    const result = makeFetchResult({
      packument: makePackument({
        name: "@my-org/utils",
        versions: {
          "1.0.0": makeVersion({ types: undefined, typings: undefined }),
        },
      }),
    });
    const output = scoreQuality(result);
    // @types/@my-org/utils → @types/my-org__utils
    const detail = output!.details.find((d) => d.includes("@types/my-org__utils"));
    expect(detail).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test script presence
// ---------------------------------------------------------------------------

describe("scoreQuality — test script presence", () => {
  it("scores test at 100 when a real test script is present", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: { "1.0.0": makeVersion({ scripts: { test: "vitest run" } }) },
      }),
    });
    const output = scoreQuality(result);
    const detail = output!.details.find((d) => d.toLowerCase().includes("test script present"));
    expect(detail).toBeDefined();
  });

  it("scores test at 0 when the test script is the npm default echo placeholder", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({
            scripts: { test: "echo \"Error: no test specified\"" },
          }),
        },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=100*0.4 + typesScore=100*0.3 + testScore=0*0.3 = 40 + 30 + 0 = 70
    expect(output!.score).toBe(70);
    const detail = output!.details.find((d) => d.toLowerCase().includes("no real test suite"));
    expect(detail).toBeDefined();
  });

  it("scores test at 0 when test script starts with echo", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ scripts: { test: "echo no tests here" } }),
        },
      }),
    });
    const output = scoreQuality(result);
    const detail = output!.details.find((d) => d.toLowerCase().includes("no real test suite") || d.toLowerCase().includes("no test script"));
    expect(detail).toBeDefined();
  });

  it("scores test at 0 when the scripts object has no test key", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ scripts: { build: "tsc" } }),
        },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=100*0.4 + typesScore=100*0.3 + testScore=0*0.3 = 70
    expect(output!.score).toBe(70);
    const detail = output!.details.find((d) => d.toLowerCase().includes("no test script"));
    expect(detail).toBeDefined();
  });

  it("scores test at 0 when scripts is undefined", () => {
    const result = makeFetchResult({
      packument: makePackument({
        versions: {
          "1.0.0": makeVersion({ scripts: undefined }),
        },
      }),
    });
    const output = scoreQuality(result);
    expect(output!.score).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Weighted blend verification
// ---------------------------------------------------------------------------

describe("scoreQuality — weighted blend", () => {
  it("blends README (40%), types (30%), tests (30%)", () => {
    // readme=100, types=50 (no bundled types), tests=100
    const result = makeFetchResult({
      packument: makePackument({
        versions: { "1.0.0": makeVersion({ types: undefined }) },
      }),
    });
    const output = scoreQuality(result);
    // 100*0.4 + 50*0.3 + 100*0.3 = 40 + 15 + 30 = 85
    expect(output!.score).toBe(85);
  });

  it("returns 0 when all signals are absent", () => {
    const result = makeFetchResult({
      packument: makePackument({
        readme: undefined,
        versions: {
          "1.0.0": makeVersion({
            readme: undefined,
            types: undefined,
            typings: undefined,
            scripts: {},
          }),
        },
      }),
    });
    const output = scoreQuality(result);
    // readmeScore=0, typesScore=50 (fallback), testScore=0
    // 0*0.4 + 50*0.3 + 0*0.3 = 15
    expect(output!.score).toBe(15);
  });
});

describe("scoreQuality — always returns a result", () => {
  it("never returns null (packument always available)", () => {
    const result = makeFetchResult();
    const output = scoreQuality(result);
    expect(output).not.toBeNull();
  });
});
