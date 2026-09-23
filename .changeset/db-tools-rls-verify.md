---
"@littleorgans/db-tools": minor
---

Add `@littleorgans/db-tools` and its `rls-verify` command, which proves row level security holds
in your own Postgres database without copying this repository's scripts. It checks that the
request role cannot bypass row level security, that every table is enabled and forced, and that
absent or expired claims reveal no rows.

By default every verification transaction is explicitly read-only and rolled back, with catalog
lookup isolated from the database search path.
`--disposable` instead creates a scratch database on the same server, applies migrations (by
default the ones `@littleorgans/db` ships) and an optional seed, verifies it and drops it. Exit
codes separate a failed check (1) from a usage error (2) and a setup failure (3), and output never
includes the password. `rlsChecks`, `asRole` and `runChecks` let a project run its own
schema-specific checks alongside. `pg` (`^8.15.0`) is a peer dependency, and `@littleorgans/db` an
optional one.
