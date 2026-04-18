import type { PackageHealth, Warning } from "@/types/index.js";

/** Severity icons matching the spec's Good examples output. */
const SEVERITY_ICON: Record<Warning["severity"], string> = {
  critical: "\u2715", // ✕
  warning:  "\u26A0", // ⚠
  info:     "\u2139", // ℹ
};

/**
 * Formats a single warning line with its severity icon.
 *
 * Example:
 *   ✕ Package is deprecated: "Use other HTTP libraries"
 */
function formatWarning(warning: Warning): string {
  const icon = SEVERITY_ICON[warning.severity];
  return `  ${icon} ${warning.message}`;
}

/**
 * Formats the warnings section.
 *
 * Returns an empty string when there are no warnings — the orchestrator
 * omits blank sections from the final output.
 *
 * Example:
 *   Warnings:
 *     ✕ Package is deprecated: "Use other HTTP libraries"
 *     ✕ 3 unpatched HIGH severity vulnerabilities in current version
 */
export default function renderWarnings(health: PackageHealth): string {
  if (health.warnings.length === 0) return "";

  const lines = ["Warnings:", ...health.warnings.map(formatWarning)];
  return lines.join("\n");
}
