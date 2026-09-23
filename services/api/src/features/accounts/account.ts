import type { Principal } from "@littleorgans/auth";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

/** The caller's organization, as this service exposes it. */
export interface Account {
  readonly id: string;
  readonly orgId: string;
  readonly createdAt: string;
}

/**
 * The slice of a scoped transaction these queries need. Declared structurally, as in the web app's
 * workspace feature, so a route test can supply a plain object instead of a Drizzle database.
 */
export interface AccountTransaction {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Runs `body` scoped to `principal`. Satisfied by `Database.withPrincipal`. */
export type ScopedRunner = <T>(
  principal: Principal,
  body: (tx: AccountTransaction) => Promise<T>,
) => Promise<T>;

// Rows come back from the driver untyped. A shape this code did not ask for is a bug, not a value.
function toAccount(row: Record<string, unknown>): Account {
  const { id, workos_org_id: orgId, created_at: createdAt } = row;
  if (typeof id !== "string" || typeof orgId !== "string" || typeof createdAt !== "string") {
    throw new TypeError("accounts row has an unexpected shape");
  }
  return { id, orgId, createdAt };
}

// Drizzle's node-postgres session returns timestamptz as Postgres text, not a Date, so the query
// writes the timestamp in the API's format itself: ISO 8601 in UTC, as Date#toISOString would.
const columns = sql`id::text, workos_org_id,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;

/**
 * The caller's account, or null when their organization has none yet.
 *
 * There is no WHERE clause, and that is the point. Row level security admits only the row whose
 * `workos_org_id` matches the claims `withPrincipal` set, so the policy is the tenancy boundary
 * and this query cannot widen it. A second tenant filter here would hide a broken policy from the
 * integration test that exists to catch one.
 */
export async function findAccount(tx: AccountTransaction): Promise<Account | null> {
  const { rows } = await tx.execute(sql`SELECT ${columns} FROM accounts`);
  const [row] = rows;
  return row === undefined ? null : toAccount(row);
}

/**
 * Creates the caller's account if it does not exist, and returns it either way.
 *
 * The organization comes from `app.current_org_id()`, the same claim the policies read, never from
 * the request. The insert policy's WITH CHECK would refuse any other value regardless.
 */
export async function provisionAccount(
  tx: AccountTransaction,
): Promise<{ readonly account: Account; readonly created: boolean }> {
  const inserted = await tx.execute(
    sql`INSERT INTO accounts (workos_org_id) VALUES (app.current_org_id())
        ON CONFLICT (workos_org_id) DO NOTHING RETURNING ${columns}`,
  );
  const [row] = inserted.rows;
  if (row !== undefined) return { account: toAccount(row), created: true };
  const existing = await findAccount(tx);
  if (existing === null) throw new Error("account conflicted on insert but is not visible");
  return { account: existing, created: false };
}
