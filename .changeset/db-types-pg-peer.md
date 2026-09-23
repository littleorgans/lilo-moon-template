---
"@littleorgans/db": minor
---

`@types/pg` (`^8.15.0`) is now a peer dependency, beside `pg`. A scoped transaction is Drizzle's
`NodePgDatabase`, and the result of `tx.execute()` is typed by `@types/pg`. Without it, those
results became `any` without an error, so a query result assigned to the wrong type compiled.
npm and pnpm's default settings install the peer for you. With `autoInstallPeers: false`, add
`@types/pg` to your devDependencies.
