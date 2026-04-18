import type { NpmPackument } from "@/types/index.js";

/**
 * Fetches the full npm packument for a package from the registry.
 * Scoped packages (e.g. @scope/name) are URL-encoded so the @ and / become
 * %40 and %2F respectively — the registry requires this encoding.
 * Throws on 404 (package not found) — this is the only hard failure in the
 * fetch layer. Throws on network error. All other errors propagate up.
 */
export default async function fetchPackument(packageName: string): Promise<NpmPackument> {
    // Scoped packages must be encoded: @scope/name -> %40scope%2Fname
    const encodedName = packageName.startsWith("@")
        ? `%40${packageName.slice(1).replace("/", "%2F")}`
        : packageName;

    const url = `https://registry.npmjs.org/${encodedName}`;

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json" },
        });
    } catch (cause) {
        throw new Error(`Network error fetching packument for "${packageName}": ${String(cause)}`, { cause });
    }

    if (response.status === 404) {
        throw new Error(`Package not found: "${packageName}"`);
    }

    if (!response.ok) {
        throw new Error(`Unexpected registry response for "${packageName}": HTTP ${response.status}`);
    }

    return response.json() as Promise<NpmPackument>;
}
