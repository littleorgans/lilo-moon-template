import { AuthError } from "./errors.js";

/**
 * Everything downstream is allowed to know about the caller.
 *
 * Nothing here is copied into our database. `userId` and `orgId` are the keys the schema joins on;
 * the three lists are read per request and never stored, because they can go stale against the
 * identity provider between one token and the next.
 */
export interface Principal {
  readonly userId: string;
  readonly orgId: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly entitlements: readonly string[];
}

function requiredString(claims: Record<string, unknown>, name: string): string {
  const value = claims[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError("claims", `Token has no usable "${name}" claim.`);
  }
  return value;
}

function optionalString(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError("claims", `Token claim "${name}" is present but not a non-empty string.`);
  }
  return value;
}

// A missing claim is normal and yields an empty list. A claim that is present but the wrong shape
// is not normal: it means the provider changed something, and silently reading it as empty would
// turn that into a permission check that quietly passes nothing.
function stringList(claims: Record<string, unknown>, name: string): readonly string[] {
  const value = claims[name];
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new AuthError("claims", `Token claim "${name}" is not a string or an array of strings.`);
  }
  return value as readonly string[];
}

/**
 * Maps verified claims onto a Principal.
 *
 * The signature is already checked by the time this runs, which proves the provider issued the
 * token. It does not prove the token carries the claims this application needs, so the shape is
 * still validated here.
 *
 * `roles` is read with a fallback to a singular `role`, because providers differ on whether
 * membership is one value or many and both spellings appear in the wild.
 */
export function toPrincipal(claims: Record<string, unknown>): Principal {
  const roles = stringList(claims, "roles");
  return {
    userId: requiredString(claims, "sub"),
    orgId: optionalString(claims, "org_id"),
    roles: roles.length > 0 ? roles : stringList(claims, "role"),
    permissions: stringList(claims, "permissions"),
    entitlements: stringList(claims, "entitlements"),
  };
}
