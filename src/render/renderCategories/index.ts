import type { CategoryName, CategoryScore, PackageHealth } from "@/types/index.js";

/** Total width of the bar in block characters. */
const BAR_WIDTH = 10;

/** Unicode block characters for filled and empty bar segments. */
const FILLED = "\u2588"; // █
const EMPTY = "\u2591";  // ░

/** The display order for categories in the report. */
const CATEGORY_ORDER: CategoryName[] = [
  "maintenance",
  "security",
  "supplyChain",
  "license",
  "community",
  "quality",
];

/** Column widths for alignment. */
const LABEL_WIDTH = 14; // "Supply Chain  " — widest label padded to this

/**
 * Renders a single Unicode bar sized proportionally to the score (0–100).
 * A score of 100 fills all 10 blocks; 0 fills none.
 *
 * Example: score=88 → "█████████░"
 */
function renderBar(score: number): string {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return FILLED.repeat(filled) + EMPTY.repeat(empty);
}

/**
 * Formats a single category row including the bar, score, label, and detail strings.
 *
 * Example:
 *   Maintenance    █████████░  88/100  Last publish: 32 days ago · Bus factor: 4 · 3 maintainers
 */
function formatCategoryRow(cat: CategoryScore): string {
  const label = cat.label.padEnd(LABEL_WIDTH);
  const bar = renderBar(cat.score);
  const scoreStr = `${cat.score}/100`.padEnd(8);
  const details = cat.details.join(" · ");
  return `${label}${bar}  ${scoreStr}${details}`;
}

/**
 * Formats all available categories as bar chart rows in the canonical display order.
 * Categories missing from the health result (null data) are silently skipped —
 * they appear instead in the unavailable signals section rendered by renderFooter.
 */
export default function renderCategories(health: PackageHealth): string {
  const rows: string[] = [];

  for (const name of CATEGORY_ORDER) {
    const cat = health.categories[name];
    if (!cat) continue;
    rows.push(formatCategoryRow(cat));
  }

  return rows.join("\n");
}
