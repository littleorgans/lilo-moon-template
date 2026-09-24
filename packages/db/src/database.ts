import type { Principal } from "@littleorgans/auth";
import type { DrizzleConfig } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { assertRoleName, runScoped } from "./scoped.js";

export interface DatabaseOptions<TSchema extends Record<string, unknown> = Record<string, never>> {
  readonly connectionString: string;
  /** The role every scoped transaction runs as. Constrained, and never chosen by a request. */
  readonly role?: string;
  readonly maxConnections?: number;
  /**
   * The project's typed schema, such as the module `db-tools drizzle-generate` writes. It types
   * every scoped transaction and enables `tx.query`. It says nothing about row level security:
   * the policies decide what a query can see, whatever the schema declares.
   */
  readonly schema?: TSchema;
}

export type ScopedTransaction<TSchema extends Record<string, unknown> = Record<string, never>> =
  NodePgDatabase<TSchema>;

export interface Database<TSchema extends Record<string, unknown> = Record<string, never>> {
  /**
   * Runs `body` as `principal`, inside one transaction, with row level security in force.
   *
   * This is the only place claims are put into Postgres. A copy of this sequence anywhere else is
   * a bug, because a caller that sets the claims itself can set them to something unverified.
   */
  withPrincipal<T>(
    principal: Principal,
    body: (tx: ScopedTransaction<TSchema>) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

/**
 * A pooled connection to Postgres.
 *
 * Nothing here disables prepared statements, and nothing needs to. That precaution matters on a
 * transaction-mode pooler, but `pg` only prepares a statement when one is given a name, so ordinary
 * queries never become named prepared statements. The equivalent `prepare: false` option belongs to
 * postgres.js and does not exist on this driver. The constraint that does apply is on callers:
 * do not use Drizzle's `.prepare()` against a pooler port.
 */
export function createDatabase<TSchema extends Record<string, unknown> = Record<string, never>>(
  options: DatabaseOptions<TSchema>,
): Database<TSchema> {
  const pool = new Pool({
    connectionString: options.connectionString,
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
  });
  // Validated here as well as in runScoped: a bad role is a deployment mistake, and it should
  // surface at startup rather than on whichever request first opens a transaction.
  const role = assertRoleName(options.role ?? "authenticated");
  const config: DrizzleConfig<TSchema> =
    options.schema === undefined ? {} : { schema: options.schema };

  return {
    async withPrincipal(principal, body) {
      // One client for the whole transaction. Taking a second from the pool would run the caller's
      // queries on a connection that never saw the SET LOCAL ROLE or the claims.
      const client = await pool.connect();
      try {
        return await runScoped(
          client,
          principal,
          role,
          async () => await body(drizzle(client, config)),
        );
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
