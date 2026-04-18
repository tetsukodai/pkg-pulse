import type { OsvVulnerability } from "@/types/index.js";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch";

/** Shape of a single OSV query object used in querybatch requests. */
type OsvQuery = {
    package: { name: string; ecosystem: "npm" };
    version: string;
};

/** Response shape from `/v1/query`. */
type OsvQueryResponse = {
    vulns?: OsvVulnerability[];
};

/** Response shape from `/v1/querybatch`. */
type OsvQueryBatchResponse = {
    results: Array<{ vulns?: OsvVulnerability[] }>;
};

/**
 * Queries the OSV database for known vulnerabilities affecting a specific
 * npm package version. Returns an empty array when no CVEs are found.
 * Returns null on network error so the orchestrator can degrade gracefully.
 */
export async function fetchVulnerabilities(
    packageName: string,
    version: string,
): Promise<OsvVulnerability[] | null> {
    try {
        const response = await fetch(OSV_QUERY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                package: { name: packageName, ecosystem: "npm" },
                version,
            }),
        });

        if (!response.ok) {
            throw new Error(`OSV query API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as OsvQueryResponse;
        return data.vulns ?? [];
    } catch {
        return null;
    }
}

/**
 * Batch-queries the OSV database for vulnerabilities across multiple npm packages.
 * Used to check direct dependencies for inherited CVE exposure.
 *
 * Returns a map of `packageName@version` → `OsvVulnerability[]`. Packages with
 * no findings map to an empty array. Returns null on network error.
 */
export async function fetchVulnerabilitiesBatch(
    queries: Array<{ name: string; version: string }>,
): Promise<Map<string, OsvVulnerability[]> | null> {
    if (queries.length === 0) return new Map();

    try {
        const osvQueries: OsvQuery[] = queries.map(({ name, version }) => ({
            package: { name, ecosystem: "npm" },
            version,
        }));

        const response = await fetch(OSV_QUERYBATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queries: osvQueries }),
        });

        if (!response.ok) {
            throw new Error(`OSV querybatch API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as OsvQueryBatchResponse;

        const resultMap = new Map<string, OsvVulnerability[]>();
        for (let i = 0; i < queries.length; i++) {
            const key = `${queries[i].name}@${queries[i].version}`;
            resultMap.set(key, data.results[i]?.vulns ?? []);
        }
        return resultMap;
    } catch {
        return null;
    }
}

export default fetchVulnerabilities;
