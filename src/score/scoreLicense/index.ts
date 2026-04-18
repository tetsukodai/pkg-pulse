import { LICENSE_NORMALIZATION_MAP, LICENSE_TIERS } from "@/types/constants.js";
import type { FetchResult, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/**
 * Normalizes a raw license string to its canonical SPDX equivalent.
 * Applies the LICENSE_NORMALIZATION_MAP lookup first, then returns
 * the input unchanged if no mapping is found.
 */
function normalizeLicense(raw: string): string {
  return LICENSE_NORMALIZATION_MAP[raw] ?? raw;
}

/**
 * Looks up a canonical SPDX identifier in the LICENSE_TIERS table.
 * Returns the numeric score (0–100) or null if the identifier is unknown.
 */
function lookupTierScore(spdxId: string): number | null {
  return (LICENSE_TIERS as Record<string, number>)[spdxId] ?? null;
}

/**
 * Resolves a compound SPDX expression with OR/AND operators.
 *
 * OR expression: takes the least restrictive (highest) score — the user
 * can choose whichever license is most permissive.
 * AND expression: takes the most restrictive (lowest) score — both licenses
 * apply, so the binding constraint governs.
 *
 * Handles simple binary expressions only (e.g. "MIT OR Apache-2.0").
 * For unrecognized compound formats, returns null.
 */
function resolveCompoundExpression(expression: string): number | null {
  if (expression.includes(" OR ")) {
    const parts = expression.split(" OR ").map((p) => p.trim());
    const scores = parts.map((p) => lookupTierScore(normalizeLicense(p))).filter((s): s is number => s !== null);
    if (scores.length === 0) return null;
    // OR = least restrictive = highest score
    return Math.max(...scores);
  }

  if (expression.includes(" AND ")) {
    const parts = expression.split(" AND ").map((p) => p.trim());
    const scores = parts.map((p) => lookupTierScore(normalizeLicense(p))).filter((s): s is number => s !== null);
    if (scores.length === 0) return null;
    // AND = most restrictive = lowest score
    return Math.min(...scores);
  }

  return null;
}

/**
 * Resolves a license string to a 0–100 score using the five-tier SPDX model.
 * Handles: canonical SPDX IDs, non-standard strings (via normalization map),
 * and compound SPDX expressions (OR/AND operators).
 * Returns 0 for missing, UNLICENSED, or completely unrecognized identifiers.
 */
function resolveLicenseScore(raw: string | undefined | null): { score: number; resolved: string } {
  if (!raw || raw.trim() === "" || raw.toUpperCase() === "UNLICENSED") {
    return { score: 0, resolved: raw ?? "none" };
  }

  const trimmed = raw.trim();

  // Try compound expression first (contains OR or AND operators)
  if (trimmed.includes(" OR ") || trimmed.includes(" AND ")) {
    const compoundScore = resolveCompoundExpression(trimmed);
    if (compoundScore !== null) {
      return { score: compoundScore, resolved: trimmed };
    }
  }

  // Try direct lookup after normalization
  const normalized = normalizeLicense(trimmed);
  const tierScore = lookupTierScore(normalized);
  if (tierScore !== null) {
    return { score: tierScore, resolved: normalized };
  }

  // Unknown license — score 0, flag as unrecognized
  return { score: 0, resolved: trimmed };
}

/**
 * Scores the License category (weight: 10%).
 *
 * Signals:
 *   - npm license field → five-tier SPDX risk model (0–100)
 *   - Non-standard strings normalized via LICENSE_NORMALIZATION_MAP
 *   - Compound SPDX expressions: OR = least restrictive, AND = most restrictive
 *   - npm/GitHub license mismatch flagged as a warning (score unaffected)
 *
 * This scorer always returns a result (even if score is 0) because the
 * npm packument is always available and always has (or lacks) a license field.
 */
export default function scoreLicense(result: FetchResult): ScorerOutput | null {
  const { packument, githubRepo } = result;

  // Use the top-level packument license field (most authoritative)
  const npmLicense = packument.license;
  const { score, resolved } = resolveLicenseScore(npmLicense);

  const details: string[] = [];
  const warnings: Warning[] = [];

  // -- License details line --------------------------------------------------
  if (!npmLicense || npmLicense.toUpperCase() === "UNLICENSED") {
    details.push("No license declared (UNLICENSED)");
    warnings.push({
      severity: "critical",
      message: "No license declared — package use may be legally risky",
    });
  } else {
    const tierLabel = getTierLabel(score);
    details.push(`${resolved} (${tierLabel})`);
  }

  // -- npm / GitHub license mismatch detection --------------------------------
  if (githubRepo?.license?.spdx_id) {
    const githubSpdx = githubRepo.license.spdx_id.toUpperCase();
    const npmSpdx = resolved.toUpperCase();

    // Normalize NOASSERTION (GitHub's placeholder for unrecognized licenses)
    const githubKnown = githubSpdx !== "NOASSERTION";

    if (githubKnown && githubSpdx !== npmSpdx) {
      details.push(`GitHub license: ${githubRepo.license.spdx_id} (mismatch with npm)`);
      warnings.push({
        severity: "warning",
        message: `License mismatch: npm declares "${resolved}", GitHub shows "${githubRepo.license.spdx_id}"`,
      });
    }
  }

  return {
    name: "license",
    score,
    weight: 0.1,
    label: "License",
    details,
    warnings,
  };
}

/** Maps a 0–100 license score to its human-readable tier name. */
function getTierLabel(score: number): string {
  if (score >= 100) return "permissive";
  if (score >= 70) return "weak copyleft";
  if (score >= 40) return "strong copyleft";
  if (score >= 20) return "network copyleft";
  return "missing / unknown";
}
