import type { PackageHealth } from "@/types/index.js";

/**
 * Formats the header block: package identity line and overall score with confidence.
 *
 * Example output:
 *   pkg-pulse: zod@3.23.8
 *
 *   Overall Health Score: 91/100  (100% signal coverage)
 */
export default function renderHeader(health: PackageHealth): string {
  const confidencePct = Math.round(health.confidence * 100);
  const coverageLabel = `(${confidencePct}% signal coverage)`;

  return [
    `pkg-pulse: ${health.name}@${health.version}`,
    "",
    `Overall Health Score: ${health.score}/100  ${coverageLabel}`,
  ].join("\n");
}
