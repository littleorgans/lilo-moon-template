# @littleorgans/db

Postgres access scoped to a verified `Principal` by row level security. Every query runs inside
`withPrincipal`, which opens one transaction, switches to the `authenticated` role, and sets the
Principal's claims. The database's policies then decide which rows the query can see.

The package ships the migrations that create the tables, policies and role that these queries
assume, and a grant for the role your service logs in as.

**Requires PostgreSQL 16 or later** (verified on PostgreSQL 17), Node.js >=24.19.0, and
`psql` for the setup below. The server requirement is separate from npm's Node engine.

## Install

```sh
pnpm add @littleorgans/db drizzle-orm pg
pnpm add -D @types/pg
```

`drizzle-orm` (`^0.45.0`), `pg` (`^8.15.0`) and `@types/pg` (`^8.15.0`) are peer dependencies, so
your service and the package share one copy of each. The types are required, not optional: without
them the query results this package exposes widen to `any` without an error.

## Use it

```ts
import { loadServiceConfig } from "@littleorgans/auth-http";
import { createDatabase } from "@littleorgans/db";
import * as schema from "@acme/drizzle-schema";
import { accounts } from "@acme/drizzle-schema";

const config = loadServiceConfig();
const database = createDatabase({ connectionString: config.databaseUrl, schema });

const visible = await database.withPrincipal(principal, async (tx) => {
  return await tx.select({ orgId: accounts.workosOrgId }).from(accounts);
});
```

`principal` is the verified `Principal` from `@littleorgans/auth`, which a service gets from
`@littleorgans/auth-http`. Create the database once per process and call `close()` at shutdown.

`schema` is your project's Drizzle schema: the module `db-tools drizzle-generate` writes from your
migrations (`@acme/drizzle-schema` above is the package the adoption guides build it into). It types
each transaction, `ScopedTransaction<typeof schema>`, and enables `tx.query`. It is optional:
without it, `tx.execute` with a `sql` template, and the query builder over tables you import,
still work. The
schema records tables and columns only. The policies decide which rows a query sees, and
`rls-verify` is what proves them.

## Set up the database

Apply the steps below in order. Steps 1–3 run as a migration administrator with schema creation,
`CREATEROLE`, and `ADMIN OPTION` on `authenticated` (or as a superuser). Table ownership alone
does not authorize role grants. Step 4 connects as a separate, unprivileged service role.

1. **Apply the migrations.** They are raw SQL in `node_modules/@littleorgans/db/migrations/`. You
   do not need Atlas or any other migration tool. Apply every file, in file-name order, each in
   one transaction:

   ```sh
   (
     export LC_ALL=C
     for file in node_modules/@littleorgans/db/migrations/*.sql; do
       psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$file" || exit
     done
   )
   ```

   The subshell fixes sorting across locales and stops on the first failed file; `-X` ignores
   local psql startup commands. Earlier files remain committed if a later file fails.

   This loop is for a fresh database only. The files are not written to be applied twice. If you
   keep a migration history, copy them into your tool's migrations directory instead, and let the
   tool record what it applied. For Atlas, copy the `.sql` files into your own migration directory
   and run `atlas migrate hash`. You can point `atlas migrate apply` at the shipped directory
   itself, which includes `atlas.sum`, only while you have no migrations of your own.

2. **Create a login role for the service.** Choose its name and keep its password in your secret
   store:

   ```sql
   CREATE ROLE orders_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
   \password orders_api
   ```

   Do not use a superuser, a role with `BYPASSRLS`, or the role that owns the tables. A superuser
   and a `BYPASSRLS` role skip every policy. The table owner can switch row level security off.

3. **Grant the login role `authenticated`.** Run the shipped grant with the role name as a psql
   variable:

   ```sh
   psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v login_role=orders_api \
     -f node_modules/@littleorgans/db/grants/login-role.sql
   ```

   It runs one statement:

   ```sql
   GRANT authenticated TO orders_api WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
   ```

   Run it once for each login role. It is safe to run again. Without it, every `withPrincipal`
   call fails with `permission denied to set role "authenticated"` (SQLSTATE `42501`). The
   `INHERIT` and `SET` options need Postgres 16 or later. `ADMIN FALSE` removes delegation
   from an existing grant by the same administrator. No broad `REVOKE` is run: audit existing
   memberships from other grantors, table privileges, and privileges inherited via other roles
   separately. Use a fresh login role to avoid these alternate access paths.

4. **Connect as the login role.** Make it the user name in the service's `DATABASE_URL`, with
   the password from your secret store.

   Leave the `role` option of `createDatabase` at its default, `authenticated`. It names the role
   each transaction switches to, not the role the service logs in as.

The files are also exported, so a script can find them without knowing the `node_modules` layout:
`import.meta.resolve("@littleorgans/db/grants/login-role.sql")`.

## Roles

| Role                                    | Created by             | Can log in | Privileges                                                                                               |
| --------------------------------------- | ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| Migration owner, for example `postgres` | Your platform          | Yes        | Owns the tables, policies and `app` functions. Applies migrations and grants.                            |
| `authenticated`                         | The identity migration | No         | `SELECT` and `INSERT` on `accounts`; `SELECT`, `INSERT` and `UPDATE` on `profiles`; the `app` functions. |
| Your login role                         | You (step 2)           | Yes        | Only membership in `authenticated` with `SET`.                                                           |

Row level security is enabled and forced on both tables, so the policies apply to every role
except superusers and `BYPASSRLS` roles. They compare each row with the claims that
`withPrincipal` sets for the transaction. A transaction without claims sees no rows.

`withPrincipal` runs `SET LOCAL ROLE authenticated`, which Postgres allows only to a member of
`authenticated` that holds the `SET` option. Both the role and the claims end at `COMMIT`, so a
pooled connection does not carry them to the next request.

## Least privilege

- The login role holds no table privileges of its own. The grant gives it membership without
  `INHERIT`, so a query outside `withPrincipal`, such as a raw `pg` query on the same connection
  string, fails with `permission denied`. `SET TRUE` also lets any code holding the connection
  run `SET ROLE authenticated` itself, inside or outside a transaction, and set whatever claims it
  likes. The grant cannot force the use of `withPrincipal`. Treat the login role's credentials
  like the service's other secrets, and let only code that verified the principal set claims.
- Give each service its own login role. Then you can revoke one without touching the others:
  `REVOKE authenticated FROM orders_api`.
- Keep the migration owner's credentials out of the service. That role can disable row level
  security.
- On a fresh bare Postgres database, `authenticated` has no `DELETE` privilege and the tables
  have no `DELETE` policy. Platform default grants may differ; inspect them before deployment.

## Versions and ordering

Each migration file name starts with a UTC timestamp, `YYYYMMDDHHMMSS`, so file-name order is the
order the migrations were written in. A released migration never changes. A later version of
this package adds only new files, which sort after the existing ones, and its changelog names
them. When you upgrade, apply only the files you have not applied yet, in file-name order. A
migration tool does this for you.

## Supabase compatibility

This is a direct Postgres connection integration, researched against Supabase's documentation
and provisioning SQL; it has not been tested on a hosted Supabase project.

- Supabase defaults to PostgreSQL 17 on its platform; older projects may still use 15. Check
  `SHOW server_version_num` before setup. Values below `160000` cannot execute the shipped grant;
  upgrade first. See
  [Supabase's version announcement](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change)
  and [upgrade guide](https://supabase.com/docs/guides/platform/upgrading).
- Supabase already creates `authenticated`. The identity migration catches that role's
  duplicate-creation error and reuses it; it does not replace or harden an existing role.
  Existing `public.accounts`, `public.profiles`, or `app` functions can still collide: this
  is a fresh-schema setup, not a merger of an existing application's schema.
- Supabase's
  [PG16+ provisioning migration](https://github.com/supabase/postgres/blob/develop/migrations/db/migrations/20250605172253_grant_with_admin_to_postgres_16_and_above.sql)
  gives `postgres` `ADMIN OPTION` on `authenticated`, so that configured role can issue the
  grant. Older or customized deployments must check `pg_auth_members` first. Use `postgres`
  for setup only, never as the service's login role: it is not a full superuser, but it holds
  extra privileges (see
  [Supabase's role documentation](https://supabase.com/docs/guides/database/postgres/roles-superuser)).
  Check `rolbypassrls` in `pg_roles` for any role you consider.
- Supabase's
  [initial grants](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql)
  can grant broader public-schema access to `anon`, `authenticated`, and `service_role`.
  These migrations add privileges; they do not remove platform defaults. Review object and
  default privileges and Data API exposure, and explicitly revoke unwanted grants as the
  owner. Do not blindly revoke Supabase's shared role memberships: other applications may
  depend on them. In particular, `TRUNCATE` is not constrained by row policies.
- The policies read `request.jwt.claims` with text `sub` and `org_id` fields. Supabase Auth
  and its Data API do not automatically supply this service's verified WorkOS principal.
  Reusing the role is not a promise of interchangeable authentication integrations.
