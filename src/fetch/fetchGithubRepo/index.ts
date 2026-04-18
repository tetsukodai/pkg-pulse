import type { GithubRepoData } from "@/types/index.js";

/**
 * Fetches the GitHub repository metadata for the given owner/repo pair.
 *
 * Injects an Authorization header when a token is provided. Returns null on
 * 403 (rate limited) or 404 (repo not found / private) — both are graceful
 * degradation cases, not hard failures. Throws on unexpected network errors
 * so the orchestrator's Promise.allSettled can map them to null.
 */
export default async function fetchGithubRepo(
    owner: string,
    repo: string,
    githubToken?: string,
): Promise<GithubRepoData | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 403 || response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`GitHub repo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GithubRepoData;
    return data;
}
