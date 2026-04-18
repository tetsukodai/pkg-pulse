import type { FetchResult, Warning } from "@/types/index.js";
import type { ScorerOutput } from "../scorerTypes.js";

/** Minimum README character count to be considered non-trivial. */
const README_MIN_LENGTH = 100;

/** Default npm test placeholder that indicates no real test suite. */
const NPM_DEFAULT_TEST_SCRIPT = "echo \"Error: no test specified\"";

/**
 * Scores README presence and length.
 * Absent or trivially short README → 0; substantive README → 100.
 */
function scoreReadme(readme: string | undefined): { score: number; detail: string } {
  if (!readme || readme.trim().length <= README_MIN_LENGTH) {
    return { score: 0, detail: "No README (or trivially short)" };
  }
  if (readme.trim().length < 500) {
    return { score: 50, detail: `README present (${readme.trim().length} chars)` };
  }
  return { score: 100, detail: `README present (${readme.trim().length} chars)` };
}

/**
 * Scores TypeScript type declaration availability.
 * Bundled types in the package are preferred; @types/ companion is acceptable.
 */
function scoreTypeDeclarations(
  versionObj: { types?: string; typings?: string } | undefined,
  packageName: string,
): { score: number; detail: string; hasAtTypes: boolean } {
  if (versionObj?.types || versionObj?.typings) {
    return {
      score: 100,
      detail: "TypeScript types bundled",
      hasAtTypes: false,
    };
  }

  // The @types/ companion is known when the name maps to a DT package;
  // we can only check its presence if the fetch layer explicitly fetched it.
  // In v1 we signal "may have @types/" and let the renderer note it as partial.
  const isScoped = packageName.startsWith("@");
  const dtName = isScoped
    ? `@types/${packageName.slice(1).replace("/", "__")}`
    : `@types/${packageName}`;

  return {
    score: 50,
    detail: `No bundled types — check ${dtName}`,
    hasAtTypes: false,
  };
}

/**
 * Scores test script presence.
 * Absent or npm-default placeholder → 0; real test script → 100.
 */
function scoreTestScript(
  scripts: Record<string, string> | undefined,
): { score: number; detail: string } {
  const testScript = scripts?.["test"];
  if (!testScript) return { score: 0, detail: "No test script" };
  if (
    testScript.trim() === NPM_DEFAULT_TEST_SCRIPT ||
    testScript.trim().startsWith("echo")
  ) {
    return { score: 0, detail: "No real test suite (npm default placeholder)" };
  }
  return { score: 100, detail: "Test script present" };
}

/**
 * Scores the Quality category (weight: 10%).
 *
 * Signals (equal-weighted blend):
 *   - README presence and non-trivial length: 40%
 *   - TypeScript type declarations (bundled or @types/): 30%
 *   - Test script presence (not npm default placeholder): 30%
 *
 * This scorer always returns a result — all signals are derived from the
 * npm packument which is always available.
 */
export default function scoreQuality(result: FetchResult): ScorerOutput | null {
  const { packument } = result;

  const latestTag = packument["dist-tags"]["latest"];
  const latestVersion = latestTag ? packument.versions[latestTag] : undefined;

  // Use packument-level readme first (most complete), fall back to version readme
  const readme = packument.readme ?? latestVersion?.readme;

  const readmeResult = scoreReadme(readme);
  const typesResult = scoreTypeDeclarations(latestVersion, packument.name);
  const testResult = scoreTestScript(latestVersion?.scripts);

  // Weighted blend: README 40%, types 30%, tests 30%
  const blended = Math.round(
    readmeResult.score * 0.4 +
    typesResult.score * 0.3 +
    testResult.score * 0.3,
  );

  const details: string[] = [
    readmeResult.detail,
    typesResult.detail,
    testResult.detail,
  ];

  const warnings: Warning[] = [];

  if (readmeResult.score === 0) {
    warnings.push({ severity: "info", message: "No README or README is too short to be useful" });
  }

  return {
    name: "quality",
    score: blended,
    weight: 0.1,
    label: "Quality",
    details,
    warnings,
  };
}
