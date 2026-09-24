---
"@littleorgans/db-tools": patch
---

Add the `db-tools` command, so a project runs its database gates from the package instead of
copying this repository's scripts. `atlas-diff`, `atlas-lint` and `atlas-apply` wrap Atlas.
`drizzle-generate` writes the typed Drizzle schema the migrations produce, and `drizzle-check`
fails when the committed schema is stale or was edited by hand. `rls-verify` runs
`rls-verify --disposable` against a scratch copy of the migrations, and `clean` removes the
container. Every command but `atlas-apply` runs in a Postgres container that belongs to the
checkout, on a port derived from its path (`LILO_PG_PORT` overrides it). The defaults follow the
adoption guides' layout: `db/migrations`, `db/schema.sql` and `db/drizzle/_generated`.

A missing Docker, Atlas or drizzle-kit fails with exit 3 and names the tool. A Docker daemon that
does not answer within 20 seconds counts as unavailable instead of hanging the command. Without
Docker, the checks skip with a message locally and fail when `CI` is set.

Atlas must be on `PATH`. `drizzle-kit` (`^0.31.0`) is a new optional peer dependency, so the project
pins the version its committed schema was generated with. The container helper is exported for
tests: `withPostgres`, `startPostgres`, `psqlInput`, `applyMigrations`, `dockerStatus`,
`dockerIsAvailable` and `removePostgres`.

Containers are started, replaced and removed by their inspected ID, and new ones carry an
`org.littleorgans.db-tools.root` label naming the checkout. Containers from the old root scripts
are reused for scratch work, but automated deletion or image replacement requires a matching
ownership label. Scratch database names include a random suffix, and stale cleanup requires an
ownership comment. Tool diagnostics redact connection URLs and credential-position passwords,
including quoted, re-encoded and overlapping values, without mangling image names.

`psqlInput` rejects URLs for another host or port and checks the inspected image and binding before
executing SQL.
