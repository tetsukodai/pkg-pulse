#!/usr/bin/env node

/**
 * CLI entry point for pkg-pulse.
 *
 * Pipeline:
 * 1. Parse the package name from process.argv (positional argument).
 * 2. Validate the name against npm naming rules — exit 3 on failure.
 * 3. Read GITHUB_TOKEN from process.env — warn to stderr when absent.
 * 4. Fetch all signals via the fetch orchestrator.
 * 5. Score the signals via the scoring engine.
 * 6. Render the terminal report via the renderer.
 * 7. Print the report to stdout and exit 0.
 *
 * Exit codes: 0 = success, 1 = package not found, 2 = total network failure,
 * 3 = invalid package name.
 */

import fetchAll from "@/fetch/index.js";
import score from "@/score/index.js";
import render from "@/render/index.js";
import validatePackageName from "./validatePackageName/index.js";

/** Parse the package name from argv (first positional argument after the script path). */
function parsePackageName(): string | undefined {
  // process.argv: [node, script, ...args]
  return process.argv[2];
}

/** Emit a warning to stderr without disrupting the stdout report. */
function warn(message: string): void {
  process.stderr.write(`\nWarning: ${message}\n`);
}

/** Print the report to stdout and exit cleanly. */
function printAndExit(report: string): void {
  process.stdout.write(report + "\n");
  process.exit(0);
}

/** Classify a thrown error to determine the correct exit code. */
function classifyError(err: unknown): { code: number; message: string } {
  if (!(err instanceof Error)) {
    return { code: 2, message: String(err) };
  }

  const msg = err.message;

  // fetchPackument throws with this prefix on 404
  if (msg.startsWith("Package not found:")) {
    return { code: 1, message: msg };
  }

  // Any other fetch-layer error is treated as a total network failure
  if (msg.startsWith("Network error") || msg.includes("fetch")) {
    return { code: 2, message: msg };
  }

  return { code: 2, message: msg };
}

async function main(): Promise<void> {
  // Step 1: Parse package name
  const rawName = parsePackageName();

  if (!rawName) {
    process.stderr.write("Usage: pkg-pulse <package-name>\n");
    process.exit(3);
  }

  // Step 2: Validate package name — exit 3 on invalid
  const validation = validatePackageName(rawName);

  if (!validation.valid) {
    process.stderr.write(`Invalid package name: ${validation.reason}\n`);
    process.exit(3);
  }

  const packageName = validation.name;

  // Step 3: Read optional GitHub token — warn when absent
  const githubToken = process.env["GITHUB_TOKEN"];

  if (!githubToken) {
    warn(
      "No GITHUB_TOKEN set — GitHub API limited to 60 requests/hour (unauthenticated).\n" +
      "Set GITHUB_TOKEN for 5,000 requests/hour and full signal coverage.",
    );
  }

  // Step 4: Fetch all signals
  let fetchResult;
  try {
    fetchResult = await fetchAll({ packageName, githubToken });
  } catch (err) {
    const { code, message } = classifyError(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(code);
  }

  // Step 5: Score the signals
  const health = score(fetchResult);

  // Step 6: Render the terminal report
  const report = render(health);

  // Step 7: Print and exit 0
  printAndExit(report);
}

main();
