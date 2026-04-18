import type { FetchResult, OsvVulnerability, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/** Severity labels as they appear in OSV `database_specific.severity`. */
type OsvSeverity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

/**
 * Extracts the highest-severity rating from an OSV vulnerability record.
 * Prefers `affected[].database_specific.severity` labels; falls back to
 * parsing CVSS numeric scores from the top-level `severity` array.
 */
function extractSeverity(vuln: OsvVulnerability): OsvSeverity {
  for (const affected of vuln.affected ?? []) {
    const raw = affected.database_specific?.severity?.toUpperCase();
    if (raw === "CRITICAL" || raw === "HIGH" || raw === "MODERATE" || raw === "LOW") {
      return raw;
    }
  }

  // Fall back to CVSS numeric score
  for (const sev of vuln.severity ?? []) {
    const cvss = parseFloat(sev.score);
    if (!isNaN(cvss)) {
      if (cvss >= 9.0) return "CRITICAL";
      if (cvss >= 7.0) return "HIGH";
      if (cvss >= 4.0) return "MODERATE";
      return "LOW";
    }
  }

  // Default to MODERATE for unknown severity
  return "MODERATE";
}

/**
 * Applies per-finding severity penalties to a starting score of 100.
 * CRITICAL triggers an immediate score-to-0 override and exits early.
 */
function applyVulnPenalties(vulns: OsvVulnerability[]): { score: number; hasCritical: boolean } {
  let score = 100;

  for (const vuln of vulns) {
    const sev = extractSeverity(vuln);
    if (sev === "CRITICAL") return { score: 0, hasCritical: true };
    if (sev === "HIGH") score = Math.max(0, score - 20);
    else if (sev === "MODERATE") score = Math.max(0, score - 10);
    else score = Math.max(0, score - 3);
  }

  return { score, hasCritical: false };
}

/**
 * Formats detail strings and warning messages for the security category output.
 */
function buildOutput(
  vulns: OsvVulnerability[],
  hasCritical: boolean,
  depCount: number,
): { details: string[]; warnings: Warning[] } {
  const details: string[] = [];
  const warnings: Warning[] = [];

  if (vulns.length === 0) {
    details.push("No known CVEs in current version");
  } else {
    // Count by severity for the summary line
    const counts: Record<OsvSeverity, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
    const sampleIds: string[] = [];
    for (const vuln of vulns) {
      counts[extractSeverity(vuln)]++;
      if (sampleIds.length < 3) sampleIds.push(vuln.id);
    }

    const severityParts: string[] = [];
    if (counts.CRITICAL > 0) severityParts.push(`${counts.CRITICAL} CRITICAL`);
    if (counts.HIGH > 0) severityParts.push(`${counts.HIGH} HIGH`);
    if (counts.MODERATE > 0) severityParts.push(`${counts.MODERATE} MODERATE`);
    if (counts.LOW > 0) severityParts.push(`${counts.LOW} LOW`);

    details.push(`${vulns.length} CVE${vulns.length !== 1 ? "s" : ""}: ${severityParts.join(", ")}`);
    details.push(`IDs: ${sampleIds.join(", ")}${vulns.length > 3 ? " …" : ""}`);

    warnings.push({
      severity: hasCritical ? "critical" : counts.HIGH > 0 ? "critical" : "warning",
      message: `${vulns.length} unpatched vulnerabilit${vulns.length !== 1 ? "ies" : "y"} in current version (${severityParts.join(", ")})`,
    });
  }

  // Deprecated dependency signal
  if (depCount > 0) {
    details.push(
      `${depCount} deprecated direct dependenc${depCount !== 1 ? "ies" : "y"}`,
    );
    warnings.push({
      severity: "warning",
      message: `${depCount} direct dependenc${depCount !== 1 ? "ies are" : "y is"} deprecated`,
    });
  } else {
    details.push("No deprecated direct dependencies");
  }

  return { details, warnings };
}

/**
 * Scores the Security category (weight: 25%).
 *
 * Signals:
 *   - Current-version CVEs from OSV, weighted by severity
 *     (CRITICAL = override to 0, HIGH = -20 each, MODERATE = -10 each, LOW = -3 each)
 *   - Deprecated direct dependencies (-5 each, from the fetch layer)
 *
 * Returns null when both `vulnerabilities` and `deprecatedDeps` are null —
 * meaning OSV was unreachable and no dependency data was available, so no
 * security signal exists.
 */
export default function scoreSecurity(result: FetchResult): ScorerOutput | null {
  const { vulnerabilities, deprecatedDeps } = result;

  // No security signal at all — cannot score
  if (vulnerabilities === null && deprecatedDeps === null) return null;

  // -- CVE penalties ---------------------------------------------------------
  let score = 100;
  let hasCritical = false;

  if (vulnerabilities !== null && vulnerabilities.length > 0) {
    const penaltyResult = applyVulnPenalties(vulnerabilities);
    score = penaltyResult.score;
    hasCritical = penaltyResult.hasCritical;
  }

  // -- Deprecated dependency penalty -----------------------------------------
  // Each deprecated direct dep subtracts 5 points; CRITICAL CVE already floors to 0
  const depCount = deprecatedDeps?.length ?? 0;
  if (!hasCritical && depCount > 0) {
    score = Math.max(0, score - depCount * 5);
  }

  const { details, warnings } = buildOutput(vulnerabilities ?? [], hasCritical, depCount);

  return {
    name: "security",
    score,
    weight: 0.25,
    label: "Security",
    details,
    warnings,
  };
}
