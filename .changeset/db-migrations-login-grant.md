---
"@littleorgans/db": minor
---

Ship the identity migrations and a login-role grant, so a service can set up its own database
without this repository. `migrations/` holds the raw SQL that creates the `accounts` and
`profiles` tables, their forced row level security policies, and the `authenticated` role that
`withPrincipal` switches to. Apply the files in file-name order with `psql` or any migration tool.
Atlas is not required.

`grants/login-role.sql` grants `authenticated` to the role your service logs in as, with
`INHERIT FALSE, SET TRUE, ADMIN FALSE`. Pass the role name as the psql variable `login_role`.
Without this grant every `withPrincipal` call fails with
`permission denied to set role "authenticated"`. It needs Postgres 16 or later. The new README
covers setup, the role model and least privilege.
