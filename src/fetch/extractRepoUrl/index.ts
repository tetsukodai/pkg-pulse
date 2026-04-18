import type { NpmPackument } from "@/types/index.js";

/** Parsed GitHub repo coordinates extracted from a packument's repository field. */
export type GithubRepoCoords = {
    owner: string;
    repo: string;
    /** Present when the packument's repository.directory field is set (monorepo). */
    directory?: string;
};

/**
 * Pure function. Extracts a GitHub owner/repo pair from the packument's
 * `repository` field. Handles the full variety of npm repository URL formats:
 *   - Full HTTPS:   https://github.com/owner/repo.git
 *   - git+https:    git+https://github.com/owner/repo.git
 *   - git+ssh:      git+ssh://git@github.com/owner/repo.git
 *   - git shorthand: git://github.com/owner/repo.git
 *   - github: prefix: github:owner/repo
 *   - bare shorthand: owner/repo (npm treats this as GitHub)
 * Returns null when the field is absent, not a GitHub URL, or unparseable.
 */
export default function extractRepoUrl(packument: NpmPackument): GithubRepoCoords | null {
    const repository = packument.repository;

    if (!repository?.url) {
        return null;
    }

    const rawUrl = repository.url;
    const directory = repository.directory;

    const coords = parseGithubUrl(rawUrl);
    if (!coords) return null;

    return directory ? { ...coords, directory } : coords;
}

/** Parses a raw repository URL string and extracts the GitHub owner/repo pair. */
function parseGithubUrl(rawUrl: string): Pick<GithubRepoCoords, "owner" | "repo"> | null {
    // Strip common protocol prefixes so the rest of the logic works on a
    // consistent base string regardless of how npm stored the URL.
    let url = rawUrl.trim();

    // git+ssh://git@github.com/owner/repo.git  ->  github.com/owner/repo.git
    // Must be stripped before the generic git+ strip to avoid a partial match.
    url = url.replace(/^git\+ssh:\/\/git@/, "");

    // git+https://github.com/owner/repo.git  ->  https://github.com/owner/repo.git
    url = url.replace(/^git\+/, "");

    // git://github.com/owner/repo.git  ->  github.com/owner/repo.git
    url = url.replace(/^git:\/\//, "");

    // github:owner/repo  ->  owner/repo  (direct shorthand, always GitHub)
    if (url.startsWith("github:")) {
        return parseOwnerRepo(url.slice("github:".length));
    }

    // https://github.com/owner/repo.git  ->  owner/repo
    const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (httpsMatch) {
        return parseOwnerRepo(httpsMatch[1]);
    }

    // github.com/owner/repo.git (after ssh prefix strip above)
    const sshMatch = url.match(/^github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (sshMatch) {
        return parseOwnerRepo(sshMatch[1]);
    }

    // Bare shorthand: owner/repo (no protocol, no host — npm treats as GitHub)
    // Must contain exactly one slash and no dots in the first segment (to avoid
    // confusing "bitbucket.org/owner/repo" which would have already failed the
    // host checks above, but being explicit here prevents false positives).
    const bareMatch = url.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (bareMatch) {
        return { owner: bareMatch[1], repo: bareMatch[2].replace(/\.git$/, "") };
    }

    return null;
}

/** Splits "owner/repo(.git)" into a coords object, or returns null if malformed. */
function parseOwnerRepo(ownerRepo: string): Pick<GithubRepoCoords, "owner" | "repo"> | null {
    const clean = ownerRepo.replace(/\.git$/, "").split("/");
    if (clean.length < 2 || !clean[0] || !clean[1]) return null;
    return { owner: clean[0], repo: clean[1] };
}
