import type { Principal } from "@lilo-moon/auth";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { assertRoleName, runScoped } from "./scoped.js";

export interface DatabaseOptions {
  readonly connectionString: string;
  /** The role every scoped transaction runs as. Constrained, and never chosen by a request. */
  readonly role?: string;
  readonly maxConnections?: number;
}

export type ScopedTransaction = NodePgDatabase;

export interface Database {
  /**
   * Runs `body` as `principal`, inside one transaction, with row level security in force.
   *
   * This is the only place claims are put into Postgres. A copy of this sequence anywhere else is
   * a bug, because a caller that sets the claims itself can set them to something unverified.
   */
  withPrincipal<T>(principal: Principal, body: (tx: ScopedTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.connectionString,
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
  });
  // Validated here as well as in runScoped: a bad role is a deployment mistake, and it should
  // surface at startup rather than on whichever request first opens a transaction.
  const role = assertRoleName(options.role ?? "authenticated");

  return {
    async withPrincipal(principal, body) {
      // One client for the whole transaction. Taking a second from the pool would run the caller's
      // queries on a connection that never saw the SET LOCAL ROLE or the claims.
      const client = await pool.connect();
      try {
        return await runScoped(client, principal, role, async () => await body(drizzle(client)));
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
