import type { FetchResult, GithubContributorStat, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/**
 * Computes the bus factor: minimum number of contributors responsible
 * for 50% of total commits. Returns null when contributor data is absent
 * or all contributors have zero commits.
 */
function computeBusFactor(contributors: GithubContributorStat[]): number | null {
  if (contributors.length === 0) return null;

  const sorted = [...contributors].sort((a, b) => b.total - a.total);
  const totalCommits = sorted.reduce((sum, c) => sum + c.total, 0);
  if (totalCommits === 0) return null;

  const threshold = totalCommits * 0.5;
  let accumulated = 0;
  let count = 0;
  for (const contributor of sorted) {
    accumulated += contributor.total;
    count++;
    if (accumulated >= threshold) break;
  }
  return count;
}

/**
 * Maps bus factor integer to a 0–100 score.
 * 1 = single point of failure (steep penalty), 4+ = full marks.
 */
function scoreBusFactor(busFactor: number): number {
  if (busFactor === 1) return 20;
  if (busFactor <= 3) return 65;
  return 100;
}

/**
 * Maps days since last publish to a 0–100 recency score using the
 * decay curve defined in the spec strategy section.
 */
function scorePublishRecency(days: number): number {
  if (days <= 90) return 100;
  if (days <= 180) return 75;
  if (days <= 365) return 50;
  if (days <= 730) return 25;
  return 0;
}

/**
 * Checks the "finished project" exception heuristic:
 * v1.0+, not deprecated, fewer than 15 open issues, non-trivial README, test script present.
 * When true, maintenance receives a floor score of 90 regardless of publish recency.
 */
function isFinishedProject(result: FetchResult): boolean {
  const latestTag = result.packument["dist-tags"]["latest"];
  if (!latestTag) return false;

  const latestVersion = result.packument.versions[latestTag];
  if (!latestVersion) return false;

  // Must be at or above v1.0.0 (major >= 1)
  const major = parseInt(latestTag.split(".")[0] ?? "0", 10);
  if (major < 1) return false;

  // Must not be deprecated
  if (latestVersion.deprecated) return false;

  // When GitHub data is available, open issues must be under 15
  if (result.githubRepo !== null && result.githubRepo.open_issues_count >= 15) return false;

  // README must be present and non-trivial (> 100 characters)
  const readme = result.packument.readme ?? latestVersion.readme ?? "";
  if (readme.length <= 100) return false;

  // Test script must exist and not be the npm default placeholder
  const testScript = latestVersion.scripts?.["test"] ?? "";
  if (!testScript || testScript.startsWith("echo")) return false;

  return true;
}

/**
 * Scores the Maintenance category (weight: 30%).
 *
 * Signals:
 *   - Publish recency decay curve (packument `time` field)
 *   - Bus factor from GitHub contributor stats
 *   - Deprecation status (immediate override to 0)
 *   - Archived repo status (immediate override to 0)
 *   - "Finished project" exception (maintenance floor of 90)
 *
 * Returns null when the packument has no publish timestamp for the latest version,
 * making recency computation impossible.
 */
export default function scoreMaintenance(result: FetchResult): ScorerOutput | null {
  const { packument, githubRepo, githubContributors } = result;

  const latestTag = packument["dist-tags"]["latest"];
  const latestVersion = latestTag ? packument.versions[latestTag] : undefined;
  const publishedAt = latestTag ? packument.time[latestTag] : undefined;

  if (!publishedAt) return null;

  // -- Compute days since last publish ----------------------------------------
  const daysSincePublish = Math.floor(
    (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  const warnings: Warning[] = [];

  // -- Archived override: score 0, no further computation --------------------
  if (githubRepo?.archived) {
    warnings.push({ severity: "critical", message: "Repository is archived — no further development expected" });
    return {
      name: "maintenance",
      score: 0,
      weight: 0.3,
      label: "Maintenance",
      details: [
        "Repository is archived — no further development expected",
        `Last publish: ${daysSincePublish} days ago`,
      ],
      warnings,
    };
  }

  // -- Deprecation override: score 0 -----------------------------------------
  const deprecated = latestVersion?.deprecated;
  if (deprecated) {
    warnings.push({ severity: "critical", message: `Package is deprecated: "${deprecated}"` });
    return {
      name: "maintenance",
      score: 0,
      weight: 0.3,
      label: "Maintenance",
      details: [`DEPRECATED: "${deprecated}"`, `Last publish: ${daysSincePublish} days ago`],
      warnings,
    };
  }

  // -- "Finished project" exception: floor of 90 -----------------------------
  if (isFinishedProject(result)) {
    return {
      name: "maintenance",
      score: 90,
      weight: 0.3,
      label: "Maintenance",
      details: [
        `Last publish: ${daysSincePublish} days ago (finished-project floor applied)`,
        `${packument.maintainers.length} maintainer${packument.maintainers.length !== 1 ? "s" : ""}`,
      ],
      warnings: [],
    };
  }

  // -- Recency score ----------------------------------------------------------
  const recencyScore = scorePublishRecency(daysSincePublish);

  const details: string[] = [
    `Last publish: ${daysSincePublish} days ago`,
    `${packument.maintainers.length} maintainer${packument.maintainers.length !== 1 ? "s" : ""}`,
  ];

  // -- Bus factor blend -------------------------------------------------------
  // When GitHub contributor stats are present, blend recency (60%) with bus factor (40%).
  let finalScore = recencyScore;

  if (githubContributors && githubContributors.length > 0) {
    const busFactor = computeBusFactor(githubContributors);
    if (busFactor !== null) {
      const busScore = scoreBusFactor(busFactor);
      finalScore = Math.round(recencyScore * 0.6 + busScore * 0.4);
      details.push(`Bus factor: ${busFactor}`);

      if (busFactor === 1) {
        warnings.push({
          severity: "warning",
          message: "Bus factor is 1 — single contributor responsible for 50%+ of commits",
        });
      }
    }
  }

  if (daysSincePublish > 730) {
    warnings.push({
      severity: "warning",
      message: `No commits in last ${Math.round(daysSincePublish / 7)} weeks`,
    });
  }

  return {
    name: "maintenance",
    score: finalScore,
    weight: 0.3,
    label: "Maintenance",
    details,
    warnings,
  };
}
