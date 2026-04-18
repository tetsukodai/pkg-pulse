import type { CategoryScore, Warning } from "@/types/index.js";

/**
 * Extended return type for category scorers.
 * Each scorer returns a `CategoryScore` plus any warnings it wants to surface.
 * The orchestrator collects warnings from all scorers and strips them before
 * returning the final `PackageHealth`.
 */
export type ScorerOutput = CategoryScore & {
  /** Warnings surfaced by this scorer (e.g. deprecated dep names, CVE IDs). */
  warnings: Warning[];
};
