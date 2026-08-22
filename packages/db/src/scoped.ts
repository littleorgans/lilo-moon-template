import type { Principal } from "@lilo-moon/auth";

/**
 * The narrow slice of a Postgres client this package needs.
 *
 * Declared structurally rather than importing `pg.PoolClient` so the statement sequence below can
 * be tested against a recording double. That sequence is the security boundary, and a boundary
 * that can only be exercised against a live database does not get exercised.
 */
export interface ScopedClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

// SET ROLE takes an identifier, and an identifier cannot be a bind parameter. The role is
// therefore interpolated, so it is validated first and never comes from a request.
const ROLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/u;

export function assertRoleName(role: string): string {
  if (!ROLE_PATTERN.test(role)) {
    throw new Error(`Refusing to SET ROLE to ${JSON.stringify(role)}: not a plain identifier.`);
  }
  return role;
}

/**
 * The claims Postgres sees, built from the verified Principal rather than from the raw token.
 *
 * The token has already been checked by the time we are here. Re-serialising the Principal means
 * the database can only ever observe values that survived verification, and keeps token parsing
 * out of the persistence layer entirely.
 */
export function claimsJson(principal: Principal): string {
  return JSON.stringify({
    sub: principal.userId,
    org_id: principal.orgId,
    roles: principal.roles,
    permissions: principal.permissions,
    entitlements: principal.entitlements,
  });
}

/**
 * Runs `body` inside one transaction scoped to `principal`.
 *
 * Everything here happens on a single client, in one explicit transaction, on purpose. The role
 * and the claims are both transaction-local, so they are gone at COMMIT. That is what stops one
 * request's identity leaking to the next borrower of a pooled connection, and it is the reason
 * this must never be split into autocommit statements.
 *
 * The rows are created here rather than by a signup webhook: the transaction that already proved
 * who the caller is is the cheapest safe place to make sure they exist.
 */
export async function runScoped<T>(
  client: ScopedClient,
  principal: Principal,
  role: string,
  body: () => Promise<T>,
): Promise<T> {
  const roleName = assertRoleName(role);
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${roleName}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claimsJson(principal),
    ]);
    // A user with no organization yet is a normal state at first sign-in, not an error. There is
    // simply no tenant row to create until they have one.
    if (principal.orgId !== null) {
      await client.query(
        "INSERT INTO accounts (workos_org_id) VALUES ($1) ON CONFLICT (workos_org_id) DO NOTHING",
        [principal.orgId],
      );
    }
    await client.query(
      "INSERT INTO profiles (workos_user_id) VALUES ($1) ON CONFLICT (workos_user_id) DO NOTHING",
      [principal.userId],
    );
    const result = await body();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A failed ROLLBACK must not replace the error that caused it, or the real cause is lost.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the original error is the one worth reporting */
    }
    throw error;
  }
}
