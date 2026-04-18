import { describe, it, expect } from "vitest";
import render from "./index.js";
import type { CategoryScore, PackageHealth, UnavailableSignal, Warning } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function makeCategory(
  name: CategoryScore["name"],
  score: number,
  weight: number,
  details: string[] = [],
): CategoryScore {
  const labels: Record<CategoryScore["name"], string> = {
    maintenance: "Maintenance",
    security: "Security",
    supplyChain: "Supply Chain",
    license: "License",
    community: "Community",
    quality: "Quality",
  };
  return { name, score, weight, label: labels[name], details };
}

function makeWarning(message: string, severity: Warning["severity"] = "warning"): Warning {
  return { severity, message };
}

function makeUnavailableSignal(signal: string, reason: string): UnavailableSignal {
  return { signal, reason };
}

/** Builds a fully-populated PackageHealth — all six categories, warnings, no unavailable signals. */
function makeFullHealth(overrides: Partial<PackageHealth> = {}): PackageHealth {
  return {
    name: "zod",
    version: "3.23.8",
    score: 91,
    confidence: 1.0,
    categories: {
      maintenance: makeCategory("maintenance", 88, 0.3, ["Last publish: 32 days ago", "Bus factor: 4"]),
      security: makeCategory("security", 100, 0.25, ["No known CVEs"]),
      supplyChain: makeCategory("supplyChain", 92, 0.15, ["No install scripts"]),
      license: makeCategory("license", 100, 0.1, ["MIT (permissive)"]),
      community: makeCategory("community", 85, 0.1, ["2.1M weekly downloads", "+6% trend"]),
      quality: makeCategory("quality", 95, 0.1, ["README present", "TypeScript types bundled"]),
    },
    warnings: [
      makeWarning("Package is deprecated: Use other HTTP libraries", "critical"),
      makeWarning("3 unpatched HIGH severity vulnerabilities in current version", "warning"),
    ],
    dataSources: ["npm registry", "GitHub API (authenticated)", "OSV"],
    unavailableSignals: [],
    ...overrides,
  };
}

/** Builds a degraded PackageHealth — some categories absent, unavailable signals present. */
function makeDegradedHealth(overrides: Partial<PackageHealth> = {}): PackageHealth {
  return {
    name: "@private-org/utils",
    version: "1.4.0",
    score: 72,
    confidence: 0.45,
    categories: {
      maintenance: makeCategory("maintenance", 76, 0.3, ["Last publish: 64 days ago"]),
      security: makeCategory("security", 100, 0.25, ["No known CVEs"]),
      supplyChain: makeCategory("supplyChain", 70, 0.15, ["postinstall script present"]),
      license: makeCategory("license", 100, 0.1, ["MIT (permissive)"]),
      community: makeCategory("community", 40, 0.1, ["340 weekly downloads"]),
      quality: makeCategory("quality", 85, 0.1, ["README present"]),
    },
    warnings: [],
    dataSources: ["npm registry", "OSV"],
    unavailableSignals: [
      makeUnavailableSignal("GitHub repo metrics", "repository field points to private GitLab instance"),
      makeUnavailableSignal("Bus factor", "requires GitHub contributor stats"),
      makeUnavailableSignal("Commit activity", "requires GitHub stats endpoint"),
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Header section
// ---------------------------------------------------------------------------

describe("render — header section", () => {
  it("contains the package name and version on the first line", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("zod@3.23.8");
  });

  it("contains 'pkg-pulse:' as a prefix", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("pkg-pulse: zod@3.23.8");
  });

  it("contains the overall health score", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("91/100");
  });

  it("contains the signal coverage percentage", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("100% signal coverage");
  });

  it("shows reduced coverage percentage for a degraded health result", () => {
    const output = render(makeDegradedHealth());
    expect(output).toContain("45% signal coverage");
  });
});

// ---------------------------------------------------------------------------
// Categories section
// ---------------------------------------------------------------------------

describe("render — categories section", () => {
  it("includes each category label for a fully-populated health result", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("Maintenance");
    expect(output).toContain("Security");
    expect(output).toContain("Supply Chain");
    expect(output).toContain("License");
    expect(output).toContain("Community");
    expect(output).toContain("Quality");
  });

  it("includes per-category scores", () => {
    const output = render(makeFullHealth());
    // At least the maintenance score (88) should appear
    expect(output).toContain("88");
  });

  it("includes category detail strings", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("No known CVEs");
    expect(output).toContain("MIT (permissive)");
  });
});

// ---------------------------------------------------------------------------
// Warnings section
// ---------------------------------------------------------------------------

describe("render — warnings section", () => {
  it("includes 'Warnings:' heading when warnings are present", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("Warnings:");
  });

  it("includes warning messages in the output", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("Package is deprecated");
    expect(output).toContain("HIGH severity vulnerabilities");
  });

  it("omits the warnings section entirely when there are no warnings", () => {
    const output = render(makeDegradedHealth()); // degraded health has no warnings
    expect(output).not.toContain("Warnings:");
  });

  it("includes a critical severity icon (✕) for critical warnings", () => {
    const health = makeFullHealth({
      warnings: [makeWarning("Critical issue", "critical")],
    });
    const output = render(health);
    expect(output).toContain("\u2715"); // ✕
  });

  it("includes a warning severity icon (⚠) for warning-level entries", () => {
    const health = makeFullHealth({
      warnings: [makeWarning("Something risky", "warning")],
    });
    const output = render(health);
    expect(output).toContain("\u26A0"); // ⚠
  });
});

// ---------------------------------------------------------------------------
// Footer section
// ---------------------------------------------------------------------------

describe("render — footer section", () => {
  it("includes 'Data sources:' line with all source names", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("Data sources:");
    expect(output).toContain("npm registry");
    expect(output).toContain("GitHub API (authenticated)");
    expect(output).toContain("OSV");
  });

  it("includes 'Unavailable signals:' heading when signals are absent", () => {
    const output = render(makeDegradedHealth());
    expect(output).toContain("Unavailable signals:");
  });

  it("includes each unavailable signal name and reason", () => {
    const output = render(makeDegradedHealth());
    expect(output).toContain("GitHub repo metrics");
    expect(output).toContain("private GitLab instance");
    expect(output).toContain("Bus factor");
  });

  it("includes the confidence advisory message when coverage is below 100%", () => {
    const output = render(makeDegradedHealth());
    // The footer emits a ⚠ advisory with the coverage percentage
    expect(output).toContain("45% of total signal weight");
    expect(output).toContain("GITHUB_TOKEN");
  });

  it("omits the confidence advisory when coverage is 100%", () => {
    const output = render(makeFullHealth()); // confidence = 1.0
    expect(output).not.toContain("GITHUB_TOKEN");
  });

  it("omits the unavailable signals section when signals list is empty", () => {
    const output = render(makeFullHealth()); // no unavailable signals
    expect(output).not.toContain("Unavailable signals:");
  });
});

// ---------------------------------------------------------------------------
// Overall output structure
// ---------------------------------------------------------------------------

describe("render — overall output structure", () => {
  it("returns a non-empty string", () => {
    const output = render(makeFullHealth());
    expect(output.length).toBeGreaterThan(0);
  });

  it("sections are separated by blank lines (double newline)", () => {
    const output = render(makeFullHealth());
    expect(output).toContain("\n\n");
  });

  it("produces output with header, categories, warnings, and footer for a fully-populated result", () => {
    const output = render(makeFullHealth());
    // Header
    expect(output).toContain("pkg-pulse:");
    // Categories
    expect(output).toContain("Maintenance");
    // Warnings
    expect(output).toContain("Warnings:");
    // Footer
    expect(output).toContain("Data sources:");
  });

  it("produces output with header, categories, and footer (no warnings) for a degraded result", () => {
    const output = render(makeDegradedHealth());
    expect(output).toContain("pkg-pulse:");
    expect(output).toContain("Maintenance");
    expect(output).not.toContain("Warnings:");
    expect(output).toContain("Unavailable signals:");
    expect(output).toContain("Data sources:");
  });
});
