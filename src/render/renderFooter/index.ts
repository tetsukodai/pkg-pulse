import type { PackageHealth, UnavailableSignal } from "@/types/index.js";

/**
 * Formats a single unavailable signal line with the em-dash prefix used in
 * the spec's Good examples.
 *
 * Example:
 *   — GitHub repo metrics: repository field points to private GitLab instance
 */
function formatUnavailableSignal(signal: UnavailableSignal): string {
  return `  \u2014 ${signal.signal}: ${signal.reason}`;
}

/**
 * Formats the footer block: data sources list, unavailable signals section (when
 * signals are missing), and the confidence advisory message when coverage is below 100%.
 *
 * Example (full coverage):
 *   Data sources: npm registry, GitHub API (authenticated), OSV
 *
 * Example (partial coverage):
 *   Unavailable signals:
 *     — GitHub repo metrics: repository field points to private GitLab instance
 *     — Bus factor: requires GitHub contributor stats
 *
 *   ⚠ Score based on 45% of total signal weight. Run with GITHUB_TOKEN for fuller coverage.
 *
 *   Data sources: npm registry, OSV
 */
export default function renderFooter(health: PackageHealth): string {
  const sections: string[] = [];

  // -- Unavailable signals section ------------------------------------------
  if (health.unavailableSignals.length > 0) {
    const signalLines = [
      "Unavailable signals:",
      ...health.unavailableSignals.map(formatUnavailableSignal),
    ];
    sections.push(signalLines.join("\n"));
  }

  // -- Confidence advisory message ------------------------------------------
  // Only shown when signal coverage is below 100% (confidence < 1.0).
  const confidencePct = Math.round(health.confidence * 100);
  if (confidencePct < 100) {
    sections.push(
      `\u26A0 Score based on ${confidencePct}% of total signal weight. Run with GITHUB_TOKEN for fuller coverage.`,
    );
  }

  // -- Data sources line -----------------------------------------------------
  sections.push(`Data sources: ${health.dataSources.join(", ")}`);

  return sections.join("\n\n");
}
