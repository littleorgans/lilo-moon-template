import { createDatabase } from "@littleorgans/db";
import type { Database } from "@littleorgans/db";

// Construct lazily so loading a route does not require DATABASE_URL.
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
