import type { Principal } from "@littleorgans/auth";
import { createDatabase } from "@littleorgans/db";
import type { Database } from "@littleorgans/db";
import * as schema from "@littleorgans/drizzle-schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * What a query needs from a scoped transaction: Drizzle over this project's generated schema.
 *
 * Any Postgres driver's database satisfies it, not only the `node-postgres` one `withPrincipal`
 * hands over, so a test builds a real one over `drizzle-orm/pg-proxy` and answers its queries from
 * a plain function. A test that needs a cast to compile is a test that has stopped describing the
 * real contract.
 */
export type Transaction = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Runs `body` scoped to `principal`. Satisfied by `Database.withPrincipal`. */
export type ScopedRunner = <T>(
  principal: Principal,
  body: (tx: Transaction) => Promise<T>,
) => Promise<T>;

// Construct lazily so loading a route does not require DATABASE_URL.
let database: Database<typeof schema> | null | undefined;

export function getDatabase(): Database<typeof schema> | null {
  if (database !== undefined) return database;
  const connectionString = process.env["DATABASE_URL"];
  database =
    connectionString === undefined || connectionString.length === 0
      ? null
      : createDatabase({ connectionString, schema });
  return database;
}
