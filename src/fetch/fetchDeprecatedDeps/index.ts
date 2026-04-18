import type { NpmPackument } from "@/types/index.js";
import fetchPackument from "../fetchPackument/index.js";

/** A direct dependency whose latest version carries a deprecation message. */
export type DeprecatedDep = {
    name: string;
    deprecated: string;
};

/**
 * Checks each direct dependency for deprecation by fetching its packument and
 * inspecting the `deprecated` field on the latest version.
 *
 * Fetches all dependency packuments in parallel via Promise.allSettled so a
 * single failing lookup does not block the others. Dependencies whose packuments
 * cannot be fetched (network error, 404) are silently skipped — they are not
 * counted as deprecated. Returns an empty array when no direct deps exist.
 */
export default async function fetchDeprecatedDeps(
    packument: NpmPackument,
): Promise<DeprecatedDep[]> {
    const latestVersion = packument["dist-tags"].latest;
    const latestVersionObj = latestVersion ? packument.versions[latestVersion] : undefined;
    const directDeps = latestVersionObj?.dependencies ?? {};
    const depNames = Object.keys(directDeps);

    if (depNames.length === 0) return [];

    // Fetch every dependency's packument in parallel. Failures are expected
    // (private packages, transient network errors) — treat them as non-deprecated.
    const settled = await Promise.allSettled(depNames.map((name) => fetchPackument(name)));

    const deprecated: DeprecatedDep[] = [];

    for (let i = 0; i < depNames.length; i++) {
        const result = settled[i];
        if (result.status !== "fulfilled") continue;

        const depPackument = result.value;
        const depLatest = depPackument["dist-tags"].latest;
        if (!depLatest) continue;

        const depLatestObj = depPackument.versions[depLatest];
        if (!depLatestObj) continue;

        // `deprecated` is a non-empty string when the package (or version) is deprecated.
        if (depLatestObj.deprecated) {
            deprecated.push({ name: depNames[i], deprecated: depLatestObj.deprecated });
        }
    }

    return deprecated;
}
