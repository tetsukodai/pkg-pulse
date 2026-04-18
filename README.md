# pkg-pulse

[![AIDE](https://img.shields.io/badge/AIDE-intent--driven-0D9488?style=flat&logo=markdown&logoColor=white)](https://github.com/aidemd-mcp/server)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Score npm package health from the command line.** pkg-pulse aggregates public signals from the npm registry, GitHub API, OSV vulnerability database, and OpenSSF Scorecard into a single weighted health score with per-category breakdowns.

---

## Features

- **Six scoring dimensions** with transparent weights — Maintenance, Security, Supply Chain Risk, License, Community, and Quality
- **No authentication required** — works out of the box with public APIs; `GITHUB_TOKEN` recommended for full signal coverage
- **Confidence indicator** — shows what percentage of signals were actually reachable
- **Graceful degradation** — missing data sources reduce confidence, not crash the tool
- **Visual terminal output** — per-category bar charts and color-coded scores
- **Supply chain analysis** — detects install scripts, maintainer churn, and publish anomalies
- **Deprecated dependency detection** in direct dependencies
- **Structured exit codes** for CI integration

## Quick Start

```bash
# Install globally
npm install -g @tetsukod.ai/pkg-pulse

# Run against any npm package
pkg-pulse zod
pkg-pulse express
pkg-pulse request
```

Or run without installing:

```bash
npx @tetsukod.ai/pkg-pulse zod
```

For development without building:

```bash
npm run dev -- zod
```

## Usage

```bash
pkg-pulse <package-name>
```

Set `GITHUB_TOKEN` for full GitHub signal coverage (commit activity, contributor count, stars):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
pkg-pulse lodash
```

Without a token, GitHub-dependent signals are skipped and the confidence percentage reflects the reduced coverage.

## Scoring Methodology

pkg-pulse evaluates packages across six weighted categories:

| Category              | Weight | What it measures                                                                   |
| --------------------- | ------ | ---------------------------------------------------------------------------------- |
| **Maintenance**       | 30%    | Publish recency, commit activity, bus factor, maintainer count, deprecation status |
| **Security**          | 25%    | Known CVEs via OSV, severity distribution, deprecated dependency vulnerabilities   |
| **Supply Chain Risk** | 15%    | Install scripts, publisher consistency, provenance (Sigstore), maintainer changes  |
| **License**           | 10%    | License type classification (permissive, copyleft, restrictive, unknown)           |
| **Community**         | 10%    | Weekly downloads, download trend, GitHub stars                                     |
| **Quality**           | 10%    | README presence, TypeScript types (bundled or DefinitelyTyped), test indicators    |

The **Overall Health Score** is a weighted sum of all categories, reported on a 0–100 scale.

## Example Output

**Healthy package:**

```
pkg-pulse: zod@3.23.8

Overall Health Score: 91/100  (100% signal coverage)

Maintenance    █████████░  88/100  Last publish: 32 days ago · Bus factor: 4 · 3 maintainers
Security       ██████████  100/100 No known CVEs in current version or direct deps
Supply Chain   █████████░  92/100  No install scripts · Consistent publisher · Sigstore provenance
License        ██████████  100/100 MIT (permissive)
Community      █████████░  85/100  2.1M weekly downloads · +6% trend · 34k stars
Quality        ██████████  95/100  README present · TypeScript types bundled · Tests present

Data sources: npm registry, GitHub API (authenticated), OSV
```

**Abandoned-but-popular package:**

```
pkg-pulse: request@2.88.2

Overall Health Score: 18/100  (100% signal coverage)

Maintenance    ░░░░░░░░░░   0/100  DEPRECATED: "Use other HTTP libraries" · Last publish: 1,842 days ago
Security       ██░░░░░░░░  22/100  3 HIGH severity CVEs (GHSA-p8p7-x288-28g6, GHSA-hwc5-pg9j-f2gx, GHSA-jr22-86mf-mmr6)
Supply Chain   █████░░░░░  55/100  No install scripts · No provenance (pre-Sigstore era)
License        ██████████  100/100 Apache-2.0 (permissive)
Community      ████████░░  75/100  14M weekly downloads · -3% trend · 25.6k stars
Quality        ████████░░  80/100  README present · TypeScript types via @types/request

Warnings:
  ✕ Package is deprecated: "Use other HTTP libraries"
  ✕ 3 unpatched HIGH severity vulnerabilities in current version
  ✕ No commits in last 52 weeks · Repo archived

Data sources: npm registry, GitHub API (authenticated), OSV
```

## Configuration

| Environment Variable | Required | Description                                                                                                                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`       | No       | GitHub personal access token. Enables commit activity, contributor count, star count, and repo metadata. Without it, these signals are skipped and confidence drops accordingly. |

## Exit Codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success — score computed and printed                    |
| `1`  | Package not found on npm                                |
| `2`  | Network failure — could not reach required data sources |
| `3`  | Invalid package name                                    |

## Development

**Prerequisites:** Node.js >= 22, npm 10+

```bash
# Install dependencies
npm install

# Type-check
npm run lint

# Run unit tests
npm run test:unit

# Build for distribution
npm run build
```

### Project Structure

```
src/
├── bin/          # CLI entrypoint and argument validation
├── fetch/        # Data fetchers (npm registry, GitHub, OSV, downloads)
├── score/        # Scoring functions for each of the six categories
├── render/       # Terminal output formatting (header, categories, warnings, footer)
└── types/        # Shared TypeScript types
```

Each module is an orchestrator (`index.ts`) backed by focused helper functions in subfolders. The architecture is designed for progressive disclosure — folder names describe what each module does.

## License

[MIT](./LICENSE)
