import type { Principal } from "@littleorgans/auth";
import type * as schema from "@littleorgans/drizzle-schema";
import { accounts } from "@littleorgans/drizzle-schema";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** The caller's organization, as this service exposes it. */
export interface Account {
  readonly id: string;
  readonly orgId: string;
  readonly createdAt: string;
}

/**
 * What these queries need from a scoped transaction: Drizzle over the project's generated schema.
 * Any Postgres driver's database satisfies it, as in the web app, so a route test builds a real one
 * over `drizzle-orm/pg-proxy` and answers its queries from a plain function.
 */
export type AccountTransaction = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Runs `body` scoped to `principal`. Satisfied by `Database.withPrincipal`. */
export type ScopedRunner = <T>(
  principal: Principal,
  body: (tx: AccountTransaction) => Promise<T>,
) => Promise<T>;

// Drizzle's node-postgres session returns timestamptz as Postgres text, not a Date, so the query
// writes the timestamp in the API's format itself: ISO 8601 in UTC, as Date#toISOString would.
const columns = {
  id: accounts.id,
  orgId: accounts.workosOrgId,
  createdAt: sql<string>`to_char(${accounts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

// Drizzle's inferred types describe the expected schema; they do not validate driver values.
// Keep the HTTP contract fail-closed if a deployed database or a SQL expression drifts.
function toAccount(row: Account): Account {
  const { id, orgId, createdAt } = row;
  if (typeof id !== "string" || typeof orgId !== "string" || typeof createdAt !== "string") {
    throw new TypeError("accounts row has an unexpected shape");
  }
  return { id, orgId, createdAt };
}

/**
 * The caller's account, or null when their organization has none yet.
 *
 * There is no WHERE clause, and that is the point. Row level security admits only the row whose
 * `workos_org_id` matches the claims `withPrincipal` set, so the policy is the tenancy boundary
 * and this query cannot widen it. A second tenant filter here would hide a broken policy from the
 * integration test that exists to catch one.
 */
export async function findAccount(tx: AccountTransaction): Promise<Account | null> {
  const [account] = await tx.select(columns).from(accounts);
  return account === undefined ? null : toAccount(account);
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
  const [inserted] = await tx
    .insert(accounts)
    .values({ workosOrgId: sql`app.current_org_id()` })
    .onConflictDoNothing({ target: accounts.workosOrgId })
    .returning(columns);
  if (inserted !== undefined) return { account: toAccount(inserted), created: true };
  const existing = await findAccount(tx);
  if (existing === null) throw new Error("account conflicted on insert but is not visible");
  return { account: existing, created: false };
}
