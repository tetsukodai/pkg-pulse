import { describe, it, expect } from "vitest";
import validatePackageName from "./index.js";

// ---------------------------------------------------------------------------
// Valid names
// ---------------------------------------------------------------------------

describe("validatePackageName — valid names", () => {
  it("accepts a simple lowercase package name", () => {
    const result = validatePackageName("lodash");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.name).toBe("lodash");
  });

  it("accepts a package name with hyphens", () => {
    const result = validatePackageName("my-package");
    expect(result.valid).toBe(true);
  });

  it("accepts a package name with dots", () => {
    const result = validatePackageName("some.package");
    expect(result.valid).toBe(true);
  });

  it("accepts a package name with underscores", () => {
    const result = validatePackageName("my_package");
    expect(result.valid).toBe(true);
  });

  it("accepts a package name with digits", () => {
    const result = validatePackageName("pkg123");
    expect(result.valid).toBe(true);
  });

  it("trims surrounding whitespace and returns the trimmed name", () => {
    const result = validatePackageName("  lodash  ");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.name).toBe("lodash");
  });

  it("accepts a 214-character name (maximum allowed)", () => {
    const name = "a".repeat(214);
    const result = validatePackageName(name);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Valid scoped names
// ---------------------------------------------------------------------------

describe("validatePackageName — valid scoped names", () => {
  it("accepts @scope/name", () => {
    const result = validatePackageName("@babel/core");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.name).toBe("@babel/core");
  });

  it("accepts @types/node", () => {
    const result = validatePackageName("@types/node");
    expect(result.valid).toBe(true);
  });

  it("accepts a scoped name with hyphens in both parts", () => {
    const result = validatePackageName("@my-scope/my-package");
    expect(result.valid).toBe(true);
  });

  it("accepts a scoped name with digits in scope", () => {
    const result = validatePackageName("@scope123/pkg");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid — empty string
// ---------------------------------------------------------------------------

describe("validatePackageName — empty string", () => {
  it("rejects an empty string", () => {
    const result = validatePackageName("");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a whitespace-only string", () => {
    const result = validatePackageName("   ");
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalid — length
// ---------------------------------------------------------------------------

describe("validatePackageName — length", () => {
  it("rejects a name longer than 214 characters", () => {
    const name = "a".repeat(215);
    const result = validatePackageName(name);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/214/);
  });
});

// ---------------------------------------------------------------------------
// Invalid — characters
// ---------------------------------------------------------------------------

describe("validatePackageName — invalid characters", () => {
  it("rejects uppercase letters", () => {
    const result = validatePackageName("MyPackage");
    expect(result.valid).toBe(false);
  });

  it("rejects spaces within the name", () => {
    const result = validatePackageName("my package");
    expect(result.valid).toBe(false);
  });

  it("rejects special characters like !", () => {
    const result = validatePackageName("my!package");
    expect(result.valid).toBe(false);
  });

  it("rejects a name starting with a dot", () => {
    const result = validatePackageName(".my-package");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/must not start/i);
  });

  it("rejects a name starting with a hyphen", () => {
    const result = validatePackageName("-my-package");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/must not start/i);
  });

  it("rejects a name ending with a dot", () => {
    const result = validatePackageName("my-package.");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/must not end/i);
  });

  it("rejects a name ending with a hyphen", () => {
    const result = validatePackageName("my-package-");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/must not end/i);
  });

  it("rejects consecutive dots", () => {
    const result = validatePackageName("my..package");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/consecutive dots/i);
  });
});

// ---------------------------------------------------------------------------
// Invalid — scoped package format errors
// ---------------------------------------------------------------------------

describe("validatePackageName — invalid scoped names", () => {
  it("rejects a scoped name with no slash (@scope only)", () => {
    const result = validatePackageName("@scope");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/\//);
  });

  it("rejects a scoped name with empty scope (@/name)", () => {
    const result = validatePackageName("@/name");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/scope/i);
  });

  it("rejects a scoped name with empty package part (@scope/)", () => {
    const result = validatePackageName("@scope/");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/name part/i);
  });

  it("rejects uppercase letters in the scope part", () => {
    const result = validatePackageName("@Scope/pkg");
    expect(result.valid).toBe(false);
  });

  it("rejects uppercase letters in the package part of a scoped name", () => {
    const result = validatePackageName("@scope/MyPkg");
    expect(result.valid).toBe(false);
  });
});
