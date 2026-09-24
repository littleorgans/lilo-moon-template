---
"@littleorgans/db": minor
---

`createDatabase` takes the project's Drizzle schema as a new `schema` option, such as the module
`db-tools drizzle-generate` writes, and types every scoped transaction by it. `Database`,
`DatabaseOptions` and `ScopedTransaction` gain a `TSchema` type parameter, so
`withPrincipal`'s `tx` is `NodePgDatabase<typeof schema>` and `tx.query` is typed. The parameter
defaults to Drizzle's empty schema, so code that passes no schema and names the types without an
argument compiles and behaves as before.

The schema describes tables and columns only. Row level security still decides which rows a query
sees, and `rls-verify` remains the check that proves the policies.
