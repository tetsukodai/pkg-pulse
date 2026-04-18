/**
 * Terminal output renderer orchestrator.
 *
 * Pure function: accepts PackageHealth and returns the complete formatted
 * terminal report string. No side effects — the CLI entry point handles stdout.
 *
 * Output sections (separated by blank lines):
 *   1. Header — package identity and overall score with confidence
 *   2. Categories — per-category bar chart rows
 *   3. Warnings — severity-tagged warning messages (omitted when empty)
 *   4. Footer — unavailable signals, confidence advisory, data sources
 */

import type { PackageHealth } from "@/types/index.js";
import renderHeader from "./renderHeader/index.js";
import renderCategories from "./renderCategories/index.js";
import renderWarnings from "./renderWarnings/index.js";
import renderFooter from "./renderFooter/index.js";

/**
 * Formats a PackageHealth result into the complete terminal report string.
 * Sections are joined with blank lines. The warnings section is omitted
 * entirely when the health result has no warnings.
 */
export default function render(health: PackageHealth): string {
  const header = renderHeader(health);
  const categories = renderCategories(health);
  const warnings = renderWarnings(health);
  const footer = renderFooter(health);

  // Build section list; warnings is excluded when empty
  const sections = [header, categories];
  if (warnings) sections.push(warnings);
  sections.push(footer);

  return sections.join("\n\n");
}
