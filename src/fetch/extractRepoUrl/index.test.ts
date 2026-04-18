import { describe, it, expect } from "vitest";
import extractRepoUrl from "./index.js";
import type { NpmPackument } from "@/types/index.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Builds a minimal NpmPackument with just the repository field set. */
function makePackument(repository?: NpmPackument["repository"]): NpmPackument {
  return {
    name: "test-pkg",
    "dist-tags": { latest: "1.0.0" },
    time: { created: "2020-01-01T00:00:00Z", modified: "2024-01-01T00:00:00Z", "1.0.0": "2024-01-01T00:00:00Z" },
    maintainers: [{ name: "alice", email: "alice@example.com" }],
    versions: {},
    repository,
  };
}

// ---------------------------------------------------------------------------
// Full HTTPS URLs
// ---------------------------------------------------------------------------

describe("extractRepoUrl — full HTTPS URL", () => {
  it("extracts owner and repo from https://github.com/owner/repo", () => {
    const result = extractRepoUrl(makePackument({ url: "https://github.com/owner/repo" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("strips .git suffix from https URL", () => {
    const result = extractRepoUrl(makePackument({ url: "https://github.com/owner/repo.git" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("handles git+https:// prefix", () => {
    const result = extractRepoUrl(
      makePackument({ url: "git+https://github.com/owner/repo.git" }),
    );
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ---------------------------------------------------------------------------
// git+ssh URLs
// ---------------------------------------------------------------------------

describe("extractRepoUrl — git+ssh URL", () => {
  it("extracts owner and repo from git+ssh://git@github.com/owner/repo.git", () => {
    const result = extractRepoUrl(
      makePackument({ url: "git+ssh://git@github.com/owner/repo.git" }),
    );
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("extracts without .git suffix in ssh URL", () => {
    const result = extractRepoUrl(
      makePackument({ url: "git+ssh://git@github.com/owner/repo" }),
    );
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ---------------------------------------------------------------------------
// git:// shorthand URLs
// ---------------------------------------------------------------------------

describe("extractRepoUrl — git:// shorthand", () => {
  it("extracts owner and repo from git://github.com/owner/repo.git", () => {
    const result = extractRepoUrl(makePackument({ url: "git://github.com/owner/repo.git" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ---------------------------------------------------------------------------
// github: prefix shorthand
// ---------------------------------------------------------------------------

describe("extractRepoUrl — github: prefix", () => {
  it("extracts owner and repo from github:owner/repo", () => {
    const result = extractRepoUrl(makePackument({ url: "github:owner/repo" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("strips .git suffix from github: shorthand", () => {
    const result = extractRepoUrl(makePackument({ url: "github:owner/repo.git" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ---------------------------------------------------------------------------
// Bare shorthand (owner/repo)
// ---------------------------------------------------------------------------

describe("extractRepoUrl — bare shorthand", () => {
  it("extracts owner and repo from bare owner/repo shorthand", () => {
    const result = extractRepoUrl(makePackument({ url: "owner/repo" }));
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ---------------------------------------------------------------------------
// Monorepo — directory field
// ---------------------------------------------------------------------------

describe("extractRepoUrl — monorepo directory field", () => {
  it("includes directory when the packument repository.directory is set", () => {
    const result = extractRepoUrl(
      makePackument({ url: "https://github.com/owner/monorepo", directory: "packages/my-pkg" }),
    );
    expect(result).toEqual({ owner: "owner", repo: "monorepo", directory: "packages/my-pkg" });
  });

  it("does not include directory when the field is absent", () => {
    const result = extractRepoUrl(
      makePackument({ url: "https://github.com/owner/repo" }),
    );
    expect(result).not.toHaveProperty("directory");
  });
});

// ---------------------------------------------------------------------------
// Non-GitHub URLs — must return null
// ---------------------------------------------------------------------------

describe("extractRepoUrl — GitLab returns null", () => {
  it("returns null for https://gitlab.com/owner/repo", () => {
    const result = extractRepoUrl(makePackument({ url: "https://gitlab.com/owner/repo" }));
    expect(result).toBeNull();
  });

  it("returns null for https://bitbucket.org/owner/repo", () => {
    const result = extractRepoUrl(makePackument({ url: "https://bitbucket.org/owner/repo" }));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing or empty field — must return null
// ---------------------------------------------------------------------------

describe("extractRepoUrl — missing or empty field", () => {
  it("returns null when repository is undefined", () => {
    const result = extractRepoUrl(makePackument(undefined));
    expect(result).toBeNull();
  });

  it("returns null when repository.url is undefined", () => {
    const result = extractRepoUrl(makePackument({ type: "git" }));
    expect(result).toBeNull();
  });

  it("returns null when repository.url is an empty string", () => {
    const result = extractRepoUrl(makePackument({ url: "" }));
    expect(result).toBeNull();
  });

  it("returns null for a malformed URL that is not GitHub", () => {
    const result = extractRepoUrl(makePackument({ url: "not-a-url" }));
    expect(result).toBeNull();
  });
});
