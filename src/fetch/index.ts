import type { FetchResult } from "@/types/index.js";
import extractRepoUrl from "./extractRepoUrl/index.js";
import fetchDeprecatedDeps from "./fetchDeprecatedDeps/index.js";
import fetchDownloads from "./fetchDownloads/index.js";
import fetchGithubCommitActivity from "./fetchGithubCommitActivity/index.js";
import fetchGithubContributors from "./fetchGithubContributors/index.js";
import fetchGithubRepo from "./fetchGithubRepo/index.js";
import fetchPackument from "./fetchPackument/index.js";
import fetchVulnerabilities from "./fetchVulnerabilities/index.js";

/** Input accepted by the fetch orchestrator. */
export type FetchInput = {
    packageName: string;
    githubToken?: string;
};

/**
 * Data-fetching layer orchestrator.
 *
 * Pipeline:
 * 1. Fetch the npm packument (sequential — it provides the GitHub repo URL,
 *    the target version, and the direct dependency list for all downstream calls).
 * 2. Extract the GitHub repo coordinates from the packument's repository field.
 * 3. Fan out all remaining fetches in parallel via Promise.allSettled.
 *    Each settled result maps to `T | null` in FetchResult — null means we
 *    tried and the data was unavailable (rate-limited, no GitHub repo, etc.).
 *
 * Only a packument 404 exits hard (package not found). Every other failure
 * degrades gracefully to null, preserving partial signal coverage.
 */
export default async function fetchAll(input: FetchInput): Promise<FetchResult> {
    const { packageName, githubToken } = input;

    // Step 1: Fetch the packument. This is a hard dependency — throws on 404
    // (package not found) or network failure, propagating up to the CLI entry.
    const packument = await fetchPackument(packageName);

    // Step 2: Extract GitHub coordinates from the repository field. Many packages
    // have no GitHub repo (GitLab, Bitbucket, no repo field at all) — null is
    // the expected case for those, not an error.
    const repoCoords = extractRepoUrl(packument);

    // Step 3: Resolve the target version for the OSV vulnerability query.
    const targetVersion = packument["dist-tags"].latest ?? "";

    // Step 4: Fan out all remaining fetches in parallel. Each is wrapped in
    // Promise.allSettled so a single failure cannot cancel the others. GitHub
    // calls are skipped (resolve to null immediately) when no repo coords exist.
    const [
        downloadsResult,
        githubRepoResult,
        githubContributorsResult,
        githubCommitActivityResult,
        vulnerabilitiesResult,
        deprecatedDepsResult,
    ] = await Promise.allSettled([
        fetchDownloads(packageName),
        repoCoords
            ? fetchGithubRepo(repoCoords.owner, repoCoords.repo, githubToken)
            : Promise.resolve(null),
        repoCoords
            ? fetchGithubContributors(repoCoords.owner, repoCoords.repo, githubToken)
            : Promise.resolve(null),
        repoCoords
            ? fetchGithubCommitActivity(repoCoords.owner, repoCoords.repo, githubToken)
            : Promise.resolve(null),
        fetchVulnerabilities(packageName, targetVersion),
        fetchDeprecatedDeps(packument),
    ]);

    // Map settled results to T | null. A rejected promise means the fetch
    // helper itself threw (network error, API failure) — treat as null.
    const downloads =
        downloadsResult.status === "fulfilled" ? downloadsResult.value : null;
    const githubRepo =
        githubRepoResult.status === "fulfilled" ? githubRepoResult.value : null;
    const githubContributors =
        githubContributorsResult.status === "fulfilled" ? githubContributorsResult.value : null;
    const githubCommitActivity =
        githubCommitActivityResult.status === "fulfilled" ? githubCommitActivityResult.value : null;
    const vulnerabilities =
        vulnerabilitiesResult.status === "fulfilled" ? vulnerabilitiesResult.value : null;
    const deprecatedDeps =
        deprecatedDepsResult.status === "fulfilled" ? deprecatedDepsResult.value : null;

    return {
        packument,
        downloads,
        githubRepo,
        githubContributors,
        githubCommitActivity,
        vulnerabilities,
        deprecatedDeps,
    };
}
