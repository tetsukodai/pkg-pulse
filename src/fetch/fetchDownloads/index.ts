import type { NpmDownloads } from "@/types/index.js";

/**
 * Fetches last-week and last-month download counts for a package from the
 * npm downloads point API. Both requests are fired in parallel.
 * Returns null if either request fails — downloads are a non-critical signal.
 */
export default async function fetchDownloads(
    packageName: string,
): Promise<{ lastWeek: NpmDownloads; lastMonth: NpmDownloads } | null> {
    const base = "https://api.npmjs.org/downloads/point";

    // Scoped packages need URL encoding for the downloads API as well
    const encodedName = packageName.startsWith("@")
        ? `%40${packageName.slice(1).replace("/", "%2F")}`
        : packageName;

    const [weekResult, monthResult] = await Promise.allSettled([
        fetchSinglePeriod(`${base}/last-week/${encodedName}`),
        fetchSinglePeriod(`${base}/last-month/${encodedName}`),
    ]);

    if (weekResult.status === "rejected" || monthResult.status === "rejected") {
        return null;
    }

    return {
        lastWeek: weekResult.value,
        lastMonth: monthResult.value,
    };
}

/** Fetches a single npm downloads-point URL and returns the parsed response. */
async function fetchSinglePeriod(url: string): Promise<NpmDownloads> {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
    });

    if (!response.ok) {
        throw new Error(`npm downloads API returned HTTP ${response.status} for ${url}`);
    }

    return response.json() as Promise<NpmDownloads>;
}
