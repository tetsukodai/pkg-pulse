/**
 * Shared domain types for pkg-pulse.
 * Covers all layers: fetch result shapes, scoring output, and terminal render input.
 */

// ---------------------------------------------------------------------------
// Score output types
// ---------------------------------------------------------------------------

/** The six scoring dimensions that make up a package's health assessment. */
export type CategoryName =
  | "maintenance"
  | "security"
  | "supplyChain"
  | "license"
  | "community"
  | "quality";

/** Score and metadata for a single category, as returned by a category scorer. */
export type CategoryScore = {
  name: CategoryName;
  /** 0–100 raw score for this category. */
  score: number;
  /** Fractional weight this category contributes to the aggregate (e.g. 0.3). */
  weight: number;
  /** Short human-readable label shown in the terminal report (e.g. "Maintenance"). */
  label: string;
  /** Detail strings shown under the bar chart row (e.g. "Last publish: 32 days ago"). */
  details: string[];
};

/** A human-readable warning attached to the top-level health result. */
export type Warning = {
  severity: "info" | "warning" | "critical";
  message: string;
};

/** A signal that could not be scored because the underlying data was unavailable. */
export type UnavailableSignal = {
  /** Short name of the signal (e.g. "Bus factor", "Commit activity"). */
  signal: string;
  /** Human-readable reason the signal is absent (e.g. "No GitHub repo URL found"). */
  reason: string;
};

/** Top-level result returned by the scoring engine and consumed by the renderer. */
export type PackageHealth = {
  name: string;
  version: string;
  /** Weighted aggregate score across all available categories, 0–100. */
  score: number;
  /** Fraction of total signal weight that was backed by real data (0–1). */
  confidence: number;
  /** One entry per category that returned data. Categories with null data are absent. */
  categories: Partial<Record<CategoryName, CategoryScore>>;
  warnings: Warning[];
  /** Data source labels shown in the footer (e.g. "npm registry", "GitHub API"). */
  dataSources: string[];
  unavailableSignals: UnavailableSignal[];
};

/** `Record<CategoryName, number>` — the six category weights must sum to 1. */
export type CategoryWeights = Record<CategoryName, number>;

// ---------------------------------------------------------------------------
// npm registry types
// ---------------------------------------------------------------------------

/** Shape of a single version object inside the npm packument's `versions` map. */
export type NpmVersionObject = {
  name: string;
  version: string;
  /** If present and non-empty, this version (or the package) is deprecated. Value is the deprecation message. */
  deprecated?: string;
  /** Runtime dependencies: `{ "lodash": "^4.17.21" }` */
  dependencies?: Record<string, string>;
  /** All lifecycle scripts — check for `preinstall`, `install`, `postinstall`. */
  scripts?: Record<string, string>;
  /** `true` when any install lifecycle script is present. */
  hasInstallScript?: boolean;
  /** Who published this specific version. */
  _npmUser?: { name: string; email: string };
  dist?: {
    tarball: string;
    shasum: string;
    integrity?: string;
    fileCount?: number;
    unpackedSize?: number;
    /** Legacy PGP signature field — present on pre-Sigstore packages, absent on modern ones. */
    "npm-signature"?: string;
    /**
     * Sigstore provenance attestations — present on packages published with npm provenance
     * (post-2023). When non-empty, this indicates the package has a verifiable supply chain
     * attestation. Absence is a weak negative signal.
     */
    attestations?: {
      url: string;
      provenance?: {
        predicateType: string;
      };
    };
  };
  license?: string;
  /** Path to bundled TypeScript types (e.g. `"./dist/index.d.ts"`). */
  types?: string;
  /** Older field — same purpose as `types`. */
  typings?: string;
  readme?: string;
};

/**
 * Relevant fields from the npm registry packument response.
 * The full packument contains every version object — we type only the fields we use.
 */
export type NpmPackument = {
  name: string;
  /** Maps tag names to version strings (e.g. `{ "latest": "1.2.3" }`). */
  "dist-tags": Record<string, string>;
  /** Maps version strings and `"created"` / `"modified"` to ISO timestamps. */
  time: Record<string, string>;
  /** Current maintainers with publish rights. */
  maintainers: Array<{ name: string; email: string }>;
  license?: string;
  repository?: {
    type?: string;
    /** The raw URL string (e.g. `"git+https://github.com/owner/repo.git"`). */
    url?: string;
    /** Subdirectory path — present for monorepo packages. */
    directory?: string;
  };
  /** Map of version string → version object. */
  versions: Record<string, NpmVersionObject>;
  readme?: string;
};

/** Response from the npm downloads point API (last-week or last-month). */
export type NpmDownloads = {
  downloads: number;
  start: string;
  end: string;
  package: string;
};

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

/** Shape of the GitHub `/repos/:owner/:repo` endpoint response (relevant fields only). */
export type GithubRepoData = {
  archived: boolean;
  /** Last push to any branch — best proxy for recent commit activity. */
  pushed_at: string;
  /** Combined count of open issues and open PRs (GitHub does not separate them in REST). */
  open_issues_count: number;
  stargazers_count: number;
  license: {
    key: string;
    name: string;
    spdx_id: string;
  } | null;
  default_branch: string;
};

/** One contributor entry from `/repos/:owner/:repo/stats/contributors`. */
export type GithubContributorStat = {
  /** Total commits by this contributor across all time. */
  total: number;
  /** Per-week breakdown — each element is one week of commit counts per day. */
  weeks: Array<{
    w: number;
    a: number;
    d: number;
    c: number;
  }>;
  author: {
    login: string;
    avatar_url: string;
  } | null;
};

/** One weekly entry from `/repos/:owner/:repo/stats/commit_activity` (last 52 weeks). */
export type GithubCommitActivity = {
  /** Per-day counts (Sun–Sat). */
  days: [number, number, number, number, number, number, number];
  /** Total commits in this week. */
  total: number;
  /** Unix timestamp for the start of the week. */
  week: number;
};

// ---------------------------------------------------------------------------
// OSV vulnerability types
// ---------------------------------------------------------------------------

/** Shape of a single vulnerability record from the OSV `/v1/query` response. */
export type OsvVulnerability = {
  id: string;
  summary?: string;
  details?: string;
  modified: string;
  published: string;
  references?: Array<{ type: string; url: string }>;
  affected?: Array<{
    package: { name: string; ecosystem: string };
    ranges?: Array<{
      type: string;
      events: Array<Record<string, string>>;
    }>;
    versions?: string[];
    database_specific?: {
      /** `"CRITICAL" | "HIGH" | "MODERATE" | "LOW"` */
      severity?: string;
      cwe_ids?: string[];
    };
  }>;
  severity?: Array<{ type: string; score: string }>;
};

// ---------------------------------------------------------------------------
// Aggregated fetch result — passed from the fetch layer to the scoring engine
// ---------------------------------------------------------------------------

/**
 * The raw data bag produced by the fetch orchestrator and consumed by the scoring engine.
 * Every field except `packument` is `T | null` — null means "we tried and the data was unavailable"
 * (rate-limited, no GitHub repo, network timeout, etc.). This is semantically distinct from
 * `undefined` (never tried). Only a packument 404 exits hard; everything else degrades to null.
 */
export type FetchResult = {
  packument: NpmPackument;
  /** Last-week and last-month download counts bundled together. */
  downloads: { lastWeek: NpmDownloads; lastMonth: NpmDownloads } | null;
  githubRepo: GithubRepoData | null;
  githubContributors: GithubContributorStat[] | null;
  githubCommitActivity: GithubCommitActivity[] | null;
  /** Vulnerabilities for the target package's current version. */
  vulnerabilities: OsvVulnerability[] | null;
  /** Direct dependencies with a non-empty `deprecated` field. */
  deprecatedDeps: Array<{ name: string; deprecated: string }> | null;
};
