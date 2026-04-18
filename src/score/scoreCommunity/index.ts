import type { FetchResult, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/**
 * Computes the download trend score as a 0–100 value.
 *
 * Trend = (lastWeek / (lastMonth / 4)) - 1
 * A positive trend (growth) maps to a high score, negative (decline) to low.
 * A perfectly flat download curve scores 70 (neutral baseline).
 */
function scoreTrend(lastWeek: number, lastMonth: number): { score: number; trendPct: number } {
  if (lastMonth === 0) return { score: 50, trendPct: 0 };

  // Normalize: compare last week against the average weekly rate of the last month
  const avgWeekly = lastMonth / 4;
  const trendRatio = lastWeek / avgWeekly; // >1 = growing, <1 = declining

  // trendRatio of 1.0 → 70 (neutral), 2.0+ → 100 (strong growth), 0 → 0 (collapsed)
  const score = Math.min(100, Math.max(0, Math.round((trendRatio / 2) * 100)));
  const trendPct = Math.round((trendRatio - 1) * 100);

  return { score, trendPct };
}

/**
 * Maps raw weekly download count to a 0–100 popularity sub-score.
 * Raw count is a weak secondary signal — trend dominates.
 */
function scoreRawDownloads(weeklyDownloads: number): number {
  if (weeklyDownloads >= 1_000_000) return 100;
  if (weeklyDownloads >= 100_000) return 80;
  if (weeklyDownloads >= 10_000) return 60;
  if (weeklyDownloads >= 1_000) return 40;
  if (weeklyDownloads >= 100) return 20;
  return 5;
}

/**
 * Maps GitHub star count to a 0–100 sub-score.
 * Stars are a tertiary signal — provides context but doesn't drive the score.
 */
function scoreStars(stars: number): number {
  if (stars >= 10_000) return 100;
  if (stars >= 1_000) return 80;
  if (stars >= 100) return 60;
  if (stars >= 10) return 40;
  return 20;
}

/**
 * Maps contributor count to a 0–100 diversity sub-score.
 * More contributors = lower single-contributor risk.
 */
function scoreContributorDiversity(count: number): number {
  if (count >= 20) return 100;
  if (count >= 10) return 80;
  if (count >= 5) return 70;
  if (count >= 3) return 55;
  if (count >= 2) return 40;
  return 20;
}

/**
 * Scores the Community category (weight: 10%).
 *
 * Signals (weighted blend):
 *   - Download trend (last-week vs last-month ratio): 50% — trend matters more than count
 *   - Raw weekly download count: 20%
 *   - GitHub stars: 15%
 *   - Contributor diversity: 15%
 *
 * Returns null when both `downloads` and `githubRepo` / `githubContributors` are null —
 * meaning no community signal is available at all.
 */
export default function scoreCommunity(result: FetchResult): ScorerOutput | null {
  const { downloads, githubRepo, githubContributors } = result;

  // No community data at all — cannot score
  if (downloads === null && githubRepo === null && githubContributors === null) return null;

  const details: string[] = [];
  const warnings: Warning[] = [];

  // -- Download trend (50% of blended score) ----------------------------------
  let trendScore = 50; // neutral default when download data is absent
  let trendPct: number | null = null;

  if (downloads !== null) {
    const { lastWeek, lastMonth } = downloads;
    const weeklyCount = lastWeek.downloads;
    const monthlyCount = lastMonth.downloads;

    const trend = scoreTrend(weeklyCount, monthlyCount);
    trendScore = trend.score;
    trendPct = trend.trendPct;

    const trendLabel =
      trendPct > 0 ? `+${trendPct}%` : trendPct < 0 ? `${trendPct}%` : "flat";
    details.push(
      `${weeklyCount.toLocaleString()} weekly downloads · ${trendLabel} trend`,
    );

    if (trendPct !== null && trendPct < -20) {
      warnings.push({
        severity: "warning",
        message: `Download trend declining: ${trendPct}% week-over-week`,
      });
    }
  }

  // -- Raw download count sub-score (20%) ------------------------------------
  const rawScore =
    downloads !== null ? scoreRawDownloads(downloads.lastWeek.downloads) : 50;

  // -- GitHub stars sub-score (15%) ------------------------------------------
  let starsScore = 50; // neutral when GitHub is unavailable
  if (githubRepo !== null) {
    starsScore = scoreStars(githubRepo.stargazers_count);
    details.push(`${githubRepo.stargazers_count.toLocaleString()} GitHub stars`);
  }

  // -- Contributor diversity sub-score (15%) ---------------------------------
  let diversityScore = 50; // neutral when contributor data is unavailable
  if (githubContributors !== null) {
    diversityScore = scoreContributorDiversity(githubContributors.length);
    details.push(`${githubContributors.length} contributor${githubContributors.length !== 1 ? "s" : ""}`);
  }

  // -- Weighted blend --------------------------------------------------------
  // Trend dominates; raw count and GitHub signals are secondary
  const blended = Math.round(
    trendScore * 0.5 + rawScore * 0.2 + starsScore * 0.15 + diversityScore * 0.15,
  );

  return {
    name: "community",
    score: blended,
    weight: 0.1,
    label: "Community",
    details,
    warnings,
  };
}
