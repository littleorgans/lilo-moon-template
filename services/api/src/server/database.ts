import { createDatabase } from "@littleorgans/db";
import type { Database } from "@littleorgans/db";

/**
 * The pool every request's scoped transaction borrows from. Built once per process.
 *
 * `DATABASE_URL` names the service's own login role, which holds only `SET` membership in
 * `authenticated` (packages/db/grants/login-role.sql). Never the migration owner, and never a
 * superuser: either one bypasses the policies that keep one organization's rows from another.
 * Connections open on first use, so a database that is down fails requests, not startup.
 */
export function openDatabase(connectionString: string): Database {
  return createDatabase({ connectionString });
}
