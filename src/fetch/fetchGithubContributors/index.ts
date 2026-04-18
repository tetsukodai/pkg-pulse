import type { GithubContributorStat } from "@/types/index.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Fetches contributor statistics from `/repos/:owner/:repo/stats/contributors`.
 *
 * GitHub returns 202 when stats are being computed server-side (cached data not
 * yet ready). This function retries up to 3 times with a 1-second delay before
 * giving up and returning null. Returns null on 403 (rate limited) or 404.
 * Throws on unexpected network errors so the orchestrator can map them to null.
 */
export default async function fetchGithubContributors(
    owner: string,
    repo: string,
    githubToken?: string,
): Promise<GithubContributorStat[] | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/stats/contributors`;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const response = await fetch(url, { headers });

        if (response.status === 403 || response.status === 404) {
            return null;
        }

        // 202 means GitHub is computing the stats — wait and retry.
        if (response.status === 202) {
            if (attempt < MAX_RETRIES - 1) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
            }
            // Exhausted retries with 202 still coming — data not ready.
            return null;
        }

        if (!response.ok) {
            throw new Error(`GitHub contributors API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as GithubContributorStat[];
        return data;
    }

    return null;
}
