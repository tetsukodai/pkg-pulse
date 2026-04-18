/** Result returned by validatePackageName. Discriminated union on `valid`. */
export type ValidatePackageNameResult =
  | { valid: true; name: string }
  | { valid: false; reason: string };

/**
 * Validates an npm package name against npm naming rules.
 *
 * Rules enforced:
 * - Must not be empty
 * - Must be 214 characters or fewer
 * - Scoped packages must match `@scope/name` where both parts are non-empty
 * - Package name (and scope if present) must contain only lowercase letters,
 *   digits, hyphens, underscores, and dots
 * - Must not start or end with a dot or hyphen
 * - Must not contain consecutive dots
 *
 * Returns `{ valid: true, name }` on success (name is trimmed).
 * Returns `{ valid: false, reason }` on failure.
 */
export default function validatePackageName(raw: string): ValidatePackageNameResult {
  const name = raw.trim();

  if (!name) {
    return { valid: false, reason: "Package name must not be empty" };
  }

  if (name.length > 214) {
    return { valid: false, reason: "Package name must be 214 characters or fewer" };
  }

  // Scoped package: @scope/name
  if (name.startsWith("@")) {
    const slashIndex = name.indexOf("/");

    if (slashIndex === -1) {
      return {
        valid: false,
        reason: "Scoped package name must include a \"/\" after the scope (e.g. @scope/name)",
      };
    }

    const scope = name.slice(1, slashIndex);
    const pkg = name.slice(slashIndex + 1);

    if (!scope) {
      return { valid: false, reason: "Scoped package scope must not be empty (e.g. @scope/name)" };
    }

    if (!pkg) {
      return { valid: false, reason: "Scoped package name part must not be empty (e.g. @scope/name)" };
    }

    const scopeError = validateNamePart(scope, "scope");
    if (scopeError) return { valid: false, reason: scopeError };

    const pkgError = validateNamePart(pkg, "package name");
    if (pkgError) return { valid: false, reason: pkgError };

    return { valid: true, name };
  }

  // Non-scoped package
  const partError = validateNamePart(name, "package name");
  if (partError) return { valid: false, reason: partError };

  return { valid: true, name };
}

/**
 * Validates a single name segment (scope or package name part) against npm rules.
 * Returns an error string on failure, or null when valid.
 */
function validateNamePart(part: string, label: string): string | null {
  if (part.startsWith(".") || part.startsWith("-")) {
    return `The ${label} must not start with a "." or "-"`;
  }

  if (part.endsWith(".") || part.endsWith("-")) {
    return `The ${label} must not end with a "." or "-"`;
  }

  if (part.includes("..")) {
    return `The ${label} must not contain consecutive dots`;
  }

  // Allow: lowercase letters, digits, hyphens, underscores, dots
  if (!/^[a-z0-9\-_.]+$/.test(part)) {
    return `The ${label} may only contain lowercase letters, digits, hyphens, underscores, and dots`;
  }

  return null;
}
