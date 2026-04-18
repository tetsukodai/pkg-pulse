import type { CategoryWeights } from "./index.js";

/**
 * Fractional weights for each of the six scoring categories.
 * Must sum to 1.0. Any change here requires updating the scoring engine
 * and the spec's strategy section — these weights are load-bearing.
 *
 * Weights reflect industry consensus:
 *   - Maintenance + Security account for 55% (the two highest-risk consumer vectors)
 *   - Community is capped at 10% to prevent popularity from masking rot
 */
export const CATEGORY_WEIGHTS = {
  maintenance: 0.3,
  security: 0.25,
  supplyChain: 0.15,
  license: 0.1,
  community: 0.1,
  quality: 0.1,
} as const satisfies CategoryWeights;

/**
 * Five-tier SPDX license risk classification.
 * Keys are canonical SPDX identifiers. Values are 0–100 scores.
 *
 * Tiers (from spec):
 *   permissive     → 100  (MIT, ISC, BSD-*, Apache-2.0, …)
 *   weakCopyleft   → 70   (LGPL-*, MPL-2.0, EPL-*)
 *   strongCopyleft → 40   (GPL-*)
 *   networkCopyleft → 20  (AGPL-*, SSPL-1.0)
 *   missing        → 0    (null, UNLICENSED, empty)
 */
export const LICENSE_TIERS = {
  // Permissive — score 100
  MIT: 100,
  ISC: 100,
  "BSD-2-Clause": 100,
  "BSD-3-Clause": 100,
  "Apache-2.0": 100,
  "0BSD": 100,
  Unlicense: 100,
  "CC0-1.0": 100,
  WTFPL: 100,
  "BSL-1.0": 100,
  "Artistic-2.0": 100,
  Zlib: 100,

  // Weak copyleft — score 70
  "LGPL-2.1-only": 70,
  "LGPL-2.1-or-later": 70,
  "LGPL-3.0-only": 70,
  "LGPL-3.0-or-later": 70,
  "MPL-2.0": 70,
  "EPL-1.0": 70,
  "EPL-2.0": 70,
  "CDDL-1.0": 70,

  // Strong copyleft — score 40
  "GPL-2.0-only": 40,
  "GPL-2.0-or-later": 40,
  "GPL-3.0-only": 40,
  "GPL-3.0-or-later": 40,

  // Network copyleft — score 20
  "AGPL-3.0-only": 20,
  "AGPL-3.0-or-later": 20,
  "SSPL-1.0": 20,
} as const satisfies Record<string, number>;

/**
 * Maps common non-standard license strings to their canonical SPDX equivalents.
 * Used to normalize the `license` field before a LICENSE_TIERS lookup.
 */
export const LICENSE_NORMALIZATION_MAP: Record<string, string> = {
  "Apache 2.0": "Apache-2.0",
  "Apache 2": "Apache-2.0",
  "Apache License 2.0": "Apache-2.0",
  "Apache-2": "Apache-2.0",
  BSD: "BSD-2-Clause",
  GPLv2: "GPL-2.0-only",
  "GPL-2": "GPL-2.0-only",
  GPLv3: "GPL-3.0-only",
  "GPL-3": "GPL-3.0-only",
  AGPLv3: "AGPL-3.0-only",
  "AGPL-3": "AGPL-3.0-only",
  LGPLv2: "LGPL-2.1-only",
  "LGPLv2.1": "LGPL-2.1-only",
  LGPLv3: "LGPL-3.0-only",
  "Public Domain": "Unlicense",
  CC0: "CC0-1.0",
};
