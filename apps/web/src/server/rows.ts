import type { Principal } from "@lilo-moon/auth";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface VisibleRows {
  readonly accounts: number;
  readonly profiles: number;
}

/**
 * The slice of a scoped transaction this page needs.
 *
 * Declared structurally, like `ScopedClient` in `packages/db`, so a test can supply a plain object
 * instead of casting a stub into a Drizzle database. A test that needs a cast to compile is a test
 * that has stopped describing the real contract.
 */
export interface CountingTransaction {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Runs `body` scoped to `principal`. Satisfied by `Database.withPrincipal`. */
export type ScopedRunner = <T>(
  principal: Principal,
  body: (tx: CountingTransaction) => Promise<T>,
) => Promise<T>;

function firstCount(result: { readonly rows: readonly Record<string, unknown>[] }): number {
  return Number(result.rows[0]?.["count"] ?? 0);
}

/**
 * Counts the rows this Principal can see, from inside the scoped transaction.
 *
 * Counted under row level security rather than from outside it, so the numbers are what the
 * policies admit and not what happens to exist. Seeing one of each is the proof that the just in
 * time inserts ran and that the policies let their owner read them back.
 */
export async function countVisibleRows(
  run: ScopedRunner,
  principal: Principal,
): Promise<VisibleRows> {
  return await run(principal, async (tx) => ({
    accounts: firstCount(await tx.execute(sql`SELECT count(*)::int AS count FROM accounts`)),
    profiles: firstCount(await tx.execute(sql`SELECT count(*)::int AS count FROM profiles`)),
  }));
}
