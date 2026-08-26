import { createDatabase } from "@lilo-moon/db";
import type { Database } from "@lilo-moon/db";

/**
 * The database, held per process, and the only thing this application composes for itself.
 *
 * Identity comes ready-made from `@lilo-moon/auth-tanstack`. Persistence does not, because a
 * product is entitled to no database, one, or several, and an auth package has no business
 * deciding which.
 *
 * Built lazily so importing a route in a test does not demand a `DATABASE_URL`.
 *
 * This file is the composition root, and its rule is one lazy getter per external service and
 * nothing else. A second service copies this getter's shape; logic that uses a service lives with
 * its feature or in `packages/`, never here, or this file becomes the pile every layer directory
 * becomes.
 */
let database: Database | null | undefined;

export function getDatabase(): Database | null {
  if (database !== undefined) return database;
  const connectionString = process.env["DATABASE_URL"];
  database =
    connectionString === undefined || connectionString.length === 0
      ? null
      : createDatabase({ connectionString });
  return database;
}
