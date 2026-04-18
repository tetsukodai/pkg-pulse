import { describe, it, expect } from "vitest";
import scoreSupplyChain from "./index.js";
import type { FetchResult, NpmPackument, NpmVersionObject } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makeVersion(overrides: Partial<NpmVersionObject> = {}): NpmVersionObject {
  return {
    name: "test-pkg",
    version: "1.0.0",
    dist: {
      tarball: "https://example.com/pkg.tgz",
      shasum: "abc",
      attestations: { url: "https://registry.npmjs.org/-/npm/v1/attestations/test-pkg@1.0.0" },
    },
    _npmUser: { name: "alice", email: "alice@example.com" },
    ...overrides,
  };
}

function makePackument(overrides: Partial<NpmPackument> = {}): NpmPackument {
  const now = Date.now();
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: {
      created: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
      modified: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      "0.9.0": new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
      "1.0.0": new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    license: "MIT",
    versions: {
      "0.9.0": makeVersion({ version: "0.9.0" }),
      "1.0.0": makeVersion({ version: "1.0.0" }),
    },
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
// Install script detection
// ---------------------------------------------------------------------------

describe("scoreSupplyChain — install script detection", () => {
  it("penalizes a package with a preinstall script (existing across versions)", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({
          version: "0.9.0",
          scripts: { preinstall: "node setup.js" },
        }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          scripts: { preinstall: "node setup.js" },
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // Install script present but not new → -15 penalty
    expect(output!.score).toBeLessThan(100);
    const detail = output!.details.find((d) => d.toLowerCase().includes("install script"));
    expect(detail).toBeDefined();
  });

  it("adds a warning for an install script", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0", scripts: { postinstall: "node post.js" } }),
        "1.0.0": makeVersion({ version: "1.0.0", scripts: { postinstall: "node post.js" } }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    const warning = output!.warnings.find((w) => w.message.toLowerCase().includes("install"));
    expect(warning).toBeDefined();
  });

  it("scores 100 when no install scripts are present and attestations provenance is present", () => {
    // Clean version with no scripts, has Sigstore attestations provenance
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0" }),
        "1.0.0": makeVersion({ version: "1.0.0" }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // No install script (-0), no maintainer change (-0), no anomaly (-0), has attestations (-0)
    expect(output!.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// New install script escalation
// ---------------------------------------------------------------------------

describe("scoreSupplyChain — new install script escalation", () => {
  it("applies escalated penalty when install script is new in the current version", () => {
    // Previous version had no scripts; current version added a postinstall
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0", scripts: {} }), // no install script
        "1.0.0": makeVersion({
          version: "1.0.0",
          scripts: { postinstall: "node evil.js" }, // NEW install script
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // Escalated: -40 total for new install script
    expect(output!.score).toBeLessThanOrEqual(60);
  });

  it("adds a critical warning for a new install script", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0", scripts: {} }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          scripts: { postinstall: "node evil.js" },
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    const criticalWarning = output!.warnings.find(
      (w) => w.severity === "critical" && w.message.toLowerCase().includes("install script"),
    );
    expect(criticalWarning).toBeDefined();
  });

  it("treats install script as non-escalated when the previous version also had it", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0", scripts: { postinstall: "node post.js" } }),
        "1.0.0": makeVersion({ version: "1.0.0", scripts: { postinstall: "node post.js" } }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    // -15 base only (not -40 escalated)
    const criticalWarning = output!.warnings.find(
      (w) => w.severity === "critical" && w.message.includes("new"),
    );
    expect(criticalWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Maintainer change detection
// ---------------------------------------------------------------------------

describe("scoreSupplyChain — maintainer change detection", () => {
  it("penalizes a publisher change between versions", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({
          version: "0.9.0",
          _npmUser: { name: "alice", email: "alice@example.com" },
        }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          _npmUser: { name: "eve", email: "eve@example.com" }, // different publisher
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    expect(output!.score).toBeLessThan(100);
    const detail = output!.details.find((d) => d.toLowerCase().includes("publisher changed"));
    expect(detail).toBeDefined();
  });

  it("adds a warning for a publisher change", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({
          version: "0.9.0",
          _npmUser: { name: "alice", email: "alice@example.com" },
        }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          _npmUser: { name: "eve", email: "eve@example.com" },
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    const warning = output!.warnings.find((w) => w.message.toLowerCase().includes("publisher"));
    expect(warning).toBeDefined();
  });

  it("does not penalize a consistent publisher", () => {
    // Both versions have the same _npmUser — no change
    const result = makeFetchResult();
    const output = scoreSupplyChain(result);
    const publisherWarning = output!.warnings.find(
      (w) => w.message.toLowerCase().includes("publisher"),
    );
    expect(publisherWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provenance signal
// ---------------------------------------------------------------------------

describe("scoreSupplyChain — provenance signal", () => {
  it("does not penalize when dist.attestations is present (Sigstore provenance)", () => {
    // Default makeVersion includes dist.attestations — no provenance penalty
    const result = makeFetchResult();
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // Score should be 100 (no other penalties in clean scenario)
    expect(output!.score).toBe(100);
    const detail = output!.details.find((d) => d.toLowerCase().includes("provenance"));
    expect(detail).toBeDefined();
  });

  it("penalizes when dist.attestations is absent", () => {
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0" }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          // No attestations field — simulates a pre-Sigstore package like `request`
          dist: { tarball: "https://example.com/pkg.tgz", shasum: "abc" },
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // -10 for no provenance
    expect(output!.score).toBe(90);
    const detail = output!.details.find((d) => d.toLowerCase().includes("no provenance"));
    expect(detail).toBeDefined();
  });

  it("penalizes when only legacy npm-signature is present but dist.attestations is absent", () => {
    // Packages like `request@2.88.2` have npm-signature (PGP) but no Sigstore attestations.
    // The old check falsely treated npm-signature as provenance — this test guards the regression.
    const packument = makePackument({
      versions: {
        "0.9.0": makeVersion({ version: "0.9.0" }),
        "1.0.0": makeVersion({
          version: "1.0.0",
          dist: {
            tarball: "https://example.com/pkg.tgz",
            shasum: "abc",
            "npm-signature": "-----BEGIN PGP SIGNATURE-----\nlegacysig\n-----END PGP SIGNATURE-----",
            // attestations deliberately absent
          },
        }),
      },
    });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).not.toBeNull();
    // -10 for no Sigstore provenance, even though npm-signature is present
    expect(output!.score).toBe(90);
    const detail = output!.details.find((d) => d.toLowerCase().includes("no provenance"));
    expect(detail).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Null return
// ---------------------------------------------------------------------------

describe("scoreSupplyChain — returns null", () => {
  it("returns null when no latest tag is present", () => {
    const packument = makePackument({ "dist-tags": {} });
    const result = makeFetchResult({ packument });
    const output = scoreSupplyChain(result);
    expect(output).toBeNull();
  });
});
