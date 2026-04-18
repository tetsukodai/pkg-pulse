import { describe, it, expect } from "vitest";
import scoreLicense from "./index.js";
import type { FetchResult, NpmPackument } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makePackument(license: string | undefined, overrides: Partial<NpmPackument> = {}): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: { "1.0.0": "2024-01-01T00:00:00Z" },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license,
    versions: { "1.0.0": { name: "test-pkg", version: "1.0.0" } },
    ...overrides,
  };
}

function makeFetchResult(license: string | undefined, overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    packument: makePackument(license),
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
// License tiers
// ---------------------------------------------------------------------------

describe("scoreLicense — permissive licenses (score 100)", () => {
  it.each(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"])(
    "scores 100 for %s",
    (license) => {
      const result = makeFetchResult(license);
      const output = scoreLicense(result);
      expect(output).not.toBeNull();
      expect(output!.score).toBe(100);
    },
  );
});

describe("scoreLicense — weak copyleft licenses (score 70)", () => {
  it.each(["LGPL-2.1-only", "LGPL-3.0-only", "LGPL-3.0-or-later", "MPL-2.0", "EPL-2.0"])(
    "scores 70 for %s",
    (license) => {
      const result = makeFetchResult(license);
      const output = scoreLicense(result);
      expect(output).not.toBeNull();
      expect(output!.score).toBe(70);
    },
  );
});

describe("scoreLicense — strong copyleft licenses (score 40)", () => {
  it.each(["GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later"])(
    "scores 40 for %s",
    (license) => {
      const result = makeFetchResult(license);
      const output = scoreLicense(result);
      expect(output).not.toBeNull();
      expect(output!.score).toBe(40);
    },
  );
});

describe("scoreLicense — network copyleft licenses (score 20)", () => {
  it.each(["AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0"])(
    "scores 20 for %s",
    (license) => {
      const result = makeFetchResult(license);
      const output = scoreLicense(result);
      expect(output).not.toBeNull();
      expect(output!.score).toBe(20);
    },
  );
});

describe("scoreLicense — missing or UNLICENSED (score 0)", () => {
  it("scores 0 when license is undefined", () => {
    const result = makeFetchResult(undefined);
    const output = scoreLicense(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBe(0);
  });

  it("scores 0 for UNLICENSED string", () => {
    const result = makeFetchResult("UNLICENSED");
    const output = scoreLicense(result);
    expect(output!.score).toBe(0);
  });

  it("scores 0 for empty string", () => {
    const result = makeFetchResult("");
    const output = scoreLicense(result);
    expect(output!.score).toBe(0);
  });

  it("adds a critical warning for UNLICENSED", () => {
    const result = makeFetchResult("UNLICENSED");
    const output = scoreLicense(result);
    const criticalWarning = output!.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
  });

  it("adds a critical warning when license is missing", () => {
    const result = makeFetchResult(undefined);
    const output = scoreLicense(result);
    const criticalWarning = output!.warnings.find((w) => w.severity === "critical");
    expect(criticalWarning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Non-standard string normalization
// ---------------------------------------------------------------------------

describe("scoreLicense — non-standard string normalization", () => {
  it("normalizes 'Apache 2.0' to Apache-2.0 (score 100)", () => {
    const result = makeFetchResult("Apache 2.0");
    const output = scoreLicense(result);
    expect(output!.score).toBe(100);
  });

  it("normalizes 'GPLv3' to GPL-3.0-only (score 40)", () => {
    const result = makeFetchResult("GPLv3");
    const output = scoreLicense(result);
    expect(output!.score).toBe(40);
  });

  it("normalizes 'GPLv2' to GPL-2.0-only (score 40)", () => {
    const result = makeFetchResult("GPLv2");
    const output = scoreLicense(result);
    expect(output!.score).toBe(40);
  });

  it("normalizes 'AGPLv3' to AGPL-3.0-only (score 20)", () => {
    const result = makeFetchResult("AGPLv3");
    const output = scoreLicense(result);
    expect(output!.score).toBe(20);
  });

  it("normalizes 'LGPLv3' to LGPL-3.0-only (score 70)", () => {
    const result = makeFetchResult("LGPLv3");
    const output = scoreLicense(result);
    expect(output!.score).toBe(70);
  });

  it("normalizes 'Public Domain' to Unlicense (score 100)", () => {
    const result = makeFetchResult("Public Domain");
    const output = scoreLicense(result);
    expect(output!.score).toBe(100);
  });

  it("scores 0 for a completely unrecognized license string", () => {
    const result = makeFetchResult("Proprietary-Internal-v2");
    const output = scoreLicense(result);
    expect(output!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Compound SPDX expressions
// ---------------------------------------------------------------------------

describe("scoreLicense — compound SPDX expressions", () => {
  it("OR expression takes the least restrictive (highest) score", () => {
    // MIT (100) OR GPL-3.0-only (40) → least restrictive = 100
    const result = makeFetchResult("MIT OR GPL-3.0-only");
    const output = scoreLicense(result);
    expect(output!.score).toBe(100);
  });

  it("AND expression takes the most restrictive (lowest) score", () => {
    // MIT (100) AND GPL-3.0-only (40) → most restrictive = 40
    const result = makeFetchResult("MIT AND GPL-3.0-only");
    const output = scoreLicense(result);
    expect(output!.score).toBe(40);
  });

  it("OR expression: Apache-2.0 OR LGPL-2.1-only → 100", () => {
    const result = makeFetchResult("Apache-2.0 OR LGPL-2.1-only");
    const output = scoreLicense(result);
    expect(output!.score).toBe(100);
  });

  it("AND expression: Apache-2.0 AND AGPL-3.0-only → 20", () => {
    const result = makeFetchResult("Apache-2.0 AND AGPL-3.0-only");
    const output = scoreLicense(result);
    expect(output!.score).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// npm / GitHub license mismatch
// ---------------------------------------------------------------------------

describe("scoreLicense — npm/GitHub license mismatch", () => {
  it("adds a mismatch warning when GitHub and npm licenses differ", () => {
    const result = makeFetchResult("MIT", {
      githubRepo: {
        archived: false,
        pushed_at: "2024-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 100,
        license: { key: "gpl-3.0", name: "GNU General Public License v3.0", spdx_id: "GPL-3.0" },
        default_branch: "main",
      },
    });
    const output = scoreLicense(result);
    const mismatchWarning = output!.warnings.find((w) => w.message.toLowerCase().includes("mismatch"));
    expect(mismatchWarning).toBeDefined();
    expect(mismatchWarning!.severity).toBe("warning");
  });

  it("does not warn when GitHub and npm licenses agree", () => {
    const result = makeFetchResult("MIT", {
      githubRepo: {
        archived: false,
        pushed_at: "2024-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 100,
        license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
        default_branch: "main",
      },
    });
    const output = scoreLicense(result);
    const mismatchWarning = output!.warnings.find((w) => w.message.toLowerCase().includes("mismatch"));
    expect(mismatchWarning).toBeUndefined();
  });

  it("does not warn for GitHub NOASSERTION license placeholder", () => {
    const result = makeFetchResult("MIT", {
      githubRepo: {
        archived: false,
        pushed_at: "2024-01-01T00:00:00Z",
        open_issues_count: 0,
        stargazers_count: 100,
        license: { key: "other", name: "Other", spdx_id: "NOASSERTION" },
        default_branch: "main",
      },
    });
    const output = scoreLicense(result);
    const mismatchWarning = output!.warnings.find((w) => w.message.toLowerCase().includes("mismatch"));
    expect(mismatchWarning).toBeUndefined();
  });
});

describe("scoreLicense — always returns a result", () => {
  it("never returns null (packument always available)", () => {
    const result = makeFetchResult("MIT");
    const output = scoreLicense(result);
    expect(output).not.toBeNull();
  });
});
