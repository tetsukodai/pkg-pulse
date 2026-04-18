/**
 * Scoring engine orchestrator.
 *
 * Accepts the aggregated FetchResult from the data-fetching layer and returns
 * a fully computed PackageHealth. The six category scorers are dispatched via
 * a handler array — adding or removing a category requires one import and one
 * array entry, with no switch statements or class hierarchies.
 *
 * After all handlers run:
 *   1. Non-null results are collected; null results record unavailable signals.
 *   2. Weights are re-normalized to the sum of available category weights.
 *   3. The aggregate score is computed over available signals only.
 *   4. Composite override caps are applied for critically unhealthy conditions.
 *   5. Confidence = (available weight sum / 1.0) as a fraction (0–1).
 *   6. Warnings from all scorers are merged into the top-level warning list.
 *
 * Composite override caps (applied after weighted aggregate):
 *   - maintenance = 0 AND security = 0 → cap at 15
 *   - security = 0 (critical CVEs)      → cap at 25
 *   - maintenance = 0 (deprecated/abandoned) → cap at 35
 *
 * These caps ensure that truly dangerous packages cannot hide behind strong
 * scores in lower-weighted categories like license, community, or supply chain.
 */

import type { CategoryName, CategoryScore, FetchResult, PackageHealth, UnavailableSignal, Warning } from "@/types/index.js";
import { CATEGORY_WEIGHTS } from "@/types/constants.js";
import scoreCommunity from "./scoreCommunity/index.js";
import scoreLicense from "./scoreLicense/index.js";
import scoreMaintenance from "./scoreMaintenance/index.js";
import scoreSecurity from "./scoreSecurity/index.js";
import scoreSupplyChain from "./scoreSupplyChain/index.js";
import scoreQuality from "./scoreQuality/index.js";
import type { ScorerOutput } from "./scorerTypes.js";

/** Scorer function type — returns an output with warnings, or null when data is unavailable. */
type Scorer = (result: FetchResult) => ScorerOutput | null;

/**
 * The handler array. Each scorer is an independent function with its own folder.
 * Order does not affect correctness — scorers are independent and composable.
 */
const scorers: Scorer[] = [
  scoreMaintenance,
  scoreSecurity,
  scoreSupplyChain,
  scoreLicense,
  scoreCommunity,
  scoreQuality,
];

/**
 * Human-readable labels for each category, used when constructing unavailable signal messages.
 * Kept close to the array so additions stay in sync.
 */
const CATEGORY_LABELS: Record<CategoryName, string> = {
  maintenance: "Maintenance",
  security: "Security",
  supplyChain: "Supply Chain",
  license: "License",
  community: "Community",
  quality: "Quality",
};

/**
 * Extracts the package version and name from the FetchResult packument.
 * Falls back to sensible defaults when dist-tags are absent.
 */
function extractPackageIdentity(result: FetchResult): { name: string; version: string } {
  const name = result.packument.name;
  const version = result.packument["dist-tags"]["latest"] ?? "unknown";
  return { name, version };
}

/**
 * Builds the list of data source labels that will appear in the report footer.
 * Labels are derived from which FetchResult fields are non-null.
 */
function buildDataSources(result: FetchResult): string[] {
  const sources: string[] = ["npm registry"];
  if (result.vulnerabilities !== null || result.deprecatedDeps !== null) {
    sources.push("OSV");
  }
  if (
    result.githubRepo !== null ||
    result.githubContributors !== null ||
    result.githubCommitActivity !== null
  ) {
    sources.push("GitHub API");
  }
  return sources;
}

/**
 * Scoring engine entry point.
 *
 * Takes the raw FetchResult from the data-fetching layer and returns a
 * PackageHealth with the aggregate score, per-category breakdowns,
 * confidence indicator, warnings, and unavailable signal list.
 */
export default function score(result: FetchResult): PackageHealth {
  const { name, version } = extractPackageIdentity(result);

  const categories: Partial<Record<CategoryName, CategoryScore>> = {};
  const unavailableSignals: UnavailableSignal[] = [];
  const allWarnings: Warning[] = [];

  // -- Step 1: Run all scorers via handler array dispatch --------------------
  // Each scorer returns a ScorerOutput | null. Null means the scorer could not
  // produce a result because required data was unavailable (rate-limited, no
  // GitHub repo, OSV unreachable, etc.).
  for (const scorer of scorers) {
    const output = scorer(result);

    if (output === null) {
      // The scorer returned null — record it as an unavailable signal.
      // We identify which category by running the scorer again... no. Instead,
      // we match the scorer to its category via index, using a parallel names array.
      continue;
    }

    // Extract warnings from the scorer output before storing the category score
    const { warnings, ...categoryScore } = output;
    categories[output.name] = categoryScore as CategoryScore;
    allWarnings.push(...warnings);
  }

  // -- Step 1b: Detect which categories are missing -------------------------
  // Re-run each scorer to find nulls and record unavailable signals.
  // (Scorers are pure functions — re-running is safe and keeps the loop clean.)
  const allCategoryNames: CategoryName[] = [
    "maintenance",
    "security",
    "supplyChain",
    "license",
    "community",
    "quality",
  ];
  for (const categoryName of allCategoryNames) {
    if (!categories[categoryName]) {
      unavailableSignals.push({
        signal: CATEGORY_LABELS[categoryName],
        reason: inferUnavailableReason(categoryName, result),
      });
    }
  }

  // -- Step 2: Re-normalize weights to available signals --------------------
  // Sum only the weights of categories that returned data.
  // This prevents missing signals from dragging the aggregate down.
  const availableWeight = Object.values(categories).reduce(
    (sum, cat) => sum + CATEGORY_WEIGHTS[cat.name],
    0,
  );

  // -- Step 3: Compute weighted aggregate -----------------------------------
  // Each category's contribution = (score * category_weight) / availableWeight
  let aggregateScore = 0;
  if (availableWeight > 0) {
    for (const cat of Object.values(categories)) {
      const normalizedWeight = CATEGORY_WEIGHTS[cat.name] / availableWeight;
      aggregateScore += cat.score * normalizedWeight;
    }
  }
  aggregateScore = Math.round(aggregateScore);

  // -- Step 3b: Apply composite override caps --------------------------------
  // A package with zero maintenance or zero security is critically unhealthy.
  // Even with strong scores in other categories, the weighted aggregate can
  // remain above 35. These hard caps prevent popularity or a permissive license
  // from masking abandoned or vulnerable packages (spec: outcomes.undesired[0]).
  const maintenanceScore = categories["maintenance"]?.score ?? null;
  const securityScore = categories["security"]?.score ?? null;

  if (maintenanceScore === 0 && securityScore === 0) {
    if (aggregateScore > 15) {
      aggregateScore = 15;
      allWarnings.push({
        severity: "critical",
        message:
          "Score capped at 15: package is both abandoned/deprecated (maintenance=0) and has critical vulnerabilities (security=0). " +
          "Strong scores in other categories cannot offset these critical risks.",
      });
    }
  } else if (securityScore === 0) {
    if (aggregateScore > 25) {
      aggregateScore = 25;
      allWarnings.push({
        severity: "critical",
        message:
          "Score capped at 25: package has critical security vulnerabilities (security=0). " +
          "No score in other categories can compensate for unpatched critical CVEs.",
      });
    }
  } else if (maintenanceScore === 0) {
    if (aggregateScore > 35) {
      aggregateScore = 35;
      allWarnings.push({
        severity: "warning",
        message:
          "Score capped at 35: package is abandoned or deprecated (maintenance=0). " +
          "High download counts or a permissive license do not offset a package with no active maintenance.",
      });
    }
  }

  // -- Step 4: Compute confidence -------------------------------------------
  // Confidence = fraction of total weight (1.0) backed by actual data.
  // A confidence of 0.6 means 60% of the signal budget was available.
  const confidence = availableWeight; // already a fraction; CATEGORY_WEIGHTS sums to 1.0

  // -- Step 5: Build data source labels for the footer ----------------------
  const dataSources = buildDataSources(result);

  return {
    name,
    version,
    score: aggregateScore,
    confidence,
    categories,
    warnings: allWarnings,
    dataSources,
    unavailableSignals,
  };
}

/**
 * Returns a human-readable reason explaining why a category produced no score.
 * Used to populate the unavailable signals section of the report.
 */
function inferUnavailableReason(category: CategoryName, result: FetchResult): string {
  switch (category) {
    case "maintenance":
      return "No publish timestamp found in packument";
    case "security":
      return result.vulnerabilities === null && result.deprecatedDeps === null
        ? "OSV API unreachable and dependency data unavailable"
        : "OSV API unreachable";
    case "supplyChain":
      return "No version history available in packument";
    case "license":
      return "Packument unavailable"; // license scorer always returns a value if packument exists
    case "community":
      return result.downloads === null
        ? "npm download stats and GitHub data unavailable"
        : "Community data unavailable";
    case "quality":
      return "Packument unavailable"; // quality scorer always returns a value if packument exists
  }
}
