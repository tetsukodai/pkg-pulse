import type { FetchResult, NpmVersionObject, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/** Install lifecycle hook names that constitute a supply chain risk signal. */
const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;

/**
 * Returns true when any install lifecycle hook is present in the given version's scripts.
 * Checks both `hasInstallScript` (computed field) and the raw `scripts` object.
 */
function hasInstallScript(version: NpmVersionObject): boolean {
  if (version.hasInstallScript) return true;
  if (!version.scripts) return false;
  return INSTALL_HOOKS.some((hook) => hook in version.scripts!);
}

/**
 * Detects whether a new install script appeared in the current version
 * that was absent in the previous version — the characteristic pattern
 * behind package hijack attacks (e.g. event-stream, ua-parser-js).
 */
function isNewInstallScript(
  currentVersion: NpmVersionObject,
  previousVersion: NpmVersionObject | undefined,
): boolean {
  if (!hasInstallScript(currentVersion)) return false;
  if (!previousVersion) return false; // Cannot compare — treat as not escalated
  return !hasInstallScript(previousVersion);
}

/**
 * Detects a new publisher appearing in the current version compared to the
 * previous version — a supply chain red flag when the maintainer set changes.
 */
function detectMaintainerChange(
  currentVersion: NpmVersionObject,
  previousVersion: NpmVersionObject | undefined,
): boolean {
  if (!currentVersion._npmUser || !previousVersion?._npmUser) return false;
  return currentVersion._npmUser.name !== previousVersion._npmUser.name;
}

/**
 * Detects a publish frequency anomaly: a package that historically publishes
 * slowly suddenly emits multiple versions in a short window.
 * Compares the number of versions published in the last 30 days against the
 * average monthly cadence over the prior six months.
 */
function detectPublishAnomaly(packument: FetchResult["packument"]): boolean {
  const timeEntries = Object.entries(packument.time)
    .filter(([k]) => k !== "created" && k !== "modified")
    .map(([, v]) => new Date(v).getTime())
    .sort((a, b) => b - a); // descending

  if (timeEntries.length < 3) return false; // Not enough history to compare

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;

  const recentCount = timeEntries.filter((t) => t >= thirtyDaysAgo).length;
  const priorWindowCount = timeEntries.filter(
    (t) => t >= sixMonthsAgo && t < thirtyDaysAgo,
  ).length;

  // Average monthly rate over the prior 5-month window
  const avgMonthly = priorWindowCount / 5;

  // Flag when the last 30 days has more than 3× the average monthly rate
  // and at least 3 versions were published in the recent window
  return avgMonthly > 0 && recentCount >= 3 && recentCount > avgMonthly * 3;
}

/**
 * Checks whether Sigstore/npm provenance is present on the current version.
 * Checks `dist.attestations` — the field populated by npm's Sigstore provenance
 * workflow (post-2023). The legacy `dist["npm-signature"]` field is PGP-only and
 * is absent on modern packages that use Sigstore, so it must not be used here.
 * Absence of attestations is a weak negative signal (not an alarm).
 */
function hasProvenance(currentVersion: NpmVersionObject): boolean {
  return !!currentVersion.dist?.attestations;
}

/**
 * Scores the Supply Chain category (weight: 15%).
 *
 * Signals (additive penalties from a base of 100):
 *   - Install script present: -15
 *   - Install script is new in current version (escalated hijack pattern): additional -25
 *   - Maintainer/publisher changed between the two most recent versions: -20
 *   - Publish frequency anomaly detected: -20
 *   - No Sigstore/npm provenance: -10 (weak signal)
 *
 * Returns null only when the packument has no version history, which is
 * extremely rare. In practice this scorer nearly always returns a value.
 */
export default function scoreSupplyChain(result: FetchResult): ScorerOutput | null {
  const { packument } = result;

  const latestTag = packument["dist-tags"]["latest"];
  if (!latestTag) return null;

  const currentVersion = packument.versions[latestTag];
  if (!currentVersion) return null;

  // Identify the previous version for comparison
  const versionTimestamps = Object.entries(packument.time)
    .filter(([k]) => k !== "created" && k !== "modified" && k in packument.versions)
    .sort(([, a], [, b]) => new Date(b).getTime() - new Date(a).getTime());

  // The latest version is first after sort; the second entry is the previous version
  const previousTag = versionTimestamps[1]?.[0];
  const previousVersion = previousTag ? packument.versions[previousTag] : undefined;

  const details: string[] = [];
  const warnings: Warning[] = [];
  let score = 100;

  // -- Install script detection -----------------------------------------------
  if (hasInstallScript(currentVersion)) {
    if (isNewInstallScript(currentVersion, previousVersion)) {
      // Escalated: new install script appeared in current version
      score = Math.max(0, score - 40); // -15 base + -25 escalation
      details.push("Install script appeared in current version (escalated risk)");
      warnings.push({
        severity: "critical",
        message: "Install script is new in the current version — characteristic hijack pattern",
      });
    } else {
      score = Math.max(0, score - 15);
      details.push("Install script present");
      warnings.push({ severity: "warning", message: "Package has an install lifecycle script" });
    }
  } else {
    details.push("No install scripts");
  }

  // -- Maintainer change detection --------------------------------------------
  if (detectMaintainerChange(currentVersion, previousVersion)) {
    score = Math.max(0, score - 20);
    details.push(
      `Publisher changed: ${previousVersion!._npmUser!.name} → ${currentVersion._npmUser!.name}`,
    );
    warnings.push({
      severity: "warning",
      message: `Publisher changed between recent versions (${previousVersion!._npmUser!.name} → ${currentVersion._npmUser!.name})`,
    });
  } else {
    details.push("Consistent publisher");
  }

  // -- Publish frequency anomaly ----------------------------------------------
  if (detectPublishAnomaly(packument)) {
    score = Math.max(0, score - 20);
    details.push("Publish frequency anomaly detected");
    warnings.push({
      severity: "warning",
      message: "Unusual publish frequency: multiple releases in a short window vs historical rate",
    });
  }

  // -- Provenance / Sigstore attestation (weak signal) -----------------------
  if (hasProvenance(currentVersion)) {
    details.push("Sigstore provenance present");
  } else {
    score = Math.max(0, score - 10);
    details.push("No provenance attestation");
  }

  return {
    name: "supplyChain",
    score,
    weight: 0.15,
    label: "Supply Chain",
    details,
    warnings,
  };
}
