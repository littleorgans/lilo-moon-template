# @littleorgans/db

Postgres access scoped to a verified `Principal` by row level security. Every query runs inside
`withPrincipal`, which opens one transaction, switches to the `authenticated` role, and sets the
Principal's claims. The database's policies then decide which rows the query can see.

The package ships the migrations that create the tables, policies and role that these queries
assume, and a grant for the role your service logs in as.

## Install

```sh
pnpm add @littleorgans/db drizzle-orm pg
```

`drizzle-orm` (`^0.45.0`) and `pg` (`^8.15.0`) are peer dependencies, so your service and the
package share one copy of each.

## Use it

```ts
import { loadServiceConfig } from "@littleorgans/auth-http";
import { createDatabase } from "@littleorgans/db";
import { sql } from "drizzle-orm";

const config = loadServiceConfig();
const database = createDatabase({ connectionString: config.databaseUrl });

const accounts = await database.withPrincipal(principal, async (tx) => {
  const result = await tx.execute(sql`SELECT workos_org_id FROM accounts`);
  return result.rows;
});
```

`principal` is the verified `Principal` from `@littleorgans/auth`, which a service gets from
`@littleorgans/auth-http`. Create the database once per process and call `close()` at shutdown.

## Set up the database

Apply the steps below in order. Steps 1 and 3 run as the role that owns your schema, the one that
applies migrations. Step 4 connects as a different role.

1. **Apply the migrations.** They are raw SQL in `node_modules/@littleorgans/db/migrations/`. You
   do not need Atlas or any other migration tool. Apply every file, in file-name order, each in
   one transaction:

   ```sh
   for file in node_modules/@littleorgans/db/migrations/*.sql; do
     psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$file"
   done
   ```

   The files are not written to be applied twice. If you keep a migration history, copy them into
   your tool's migrations directory instead, and let the tool record what it applied. For Atlas,
   copy them into `db/migrations/` and run `atlas migrate hash`.

2. **Create a login role for the service.** Choose its name and keep its password in your secret
   store:

   ```sql
   CREATE ROLE orders_api LOGIN;
   \password orders_api
   ```

   Do not use a superuser, a role with `BYPASSRLS`, or the role that owns the tables. A superuser
   and a `BYPASSRLS` role skip every policy. The table owner can switch row level security off.

3. **Grant the login role `authenticated`.** Run the shipped grant with the role name as a psql
   variable:

   ```sh
   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v login_role=orders_api \
     -f node_modules/@littleorgans/db/grants/login-role.sql
   ```

   It runs one statement:

   ```sql
   GRANT authenticated TO orders_api WITH INHERIT FALSE, SET TRUE;
   ```

   Run it once for each login role. It is safe to run again. Without it, every `withPrincipal`
   call fails with `permission denied to set role "authenticated"` (SQLSTATE `42501`). The
   `INHERIT` and `SET` options need Postgres 16 or later.

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
  string, fails with `permission denied`. The only way it reaches a table is a scoped transaction,
  where the policies apply.
- Give each service its own login role. Then you can revoke one without touching the others:
  `REVOKE authenticated FROM orders_api`.
- Keep the migration owner's credentials out of the service. That role can disable row level
  security.
- `authenticated` has no `DELETE` privilege and the tables have no `DELETE` policy. Deletion is
  denied until a migration defines it.

## Versions and ordering

Each migration file name starts with a UTC timestamp, `YYYYMMDDHHMMSS`, so file-name order is the
order the migrations were written in. A released migration never changes. A later version of
this package adds only new files, which sort after the existing ones, and its changelog names
them. When you upgrade, apply only the files you have not applied yet, in file-name order. A
migration tool does this for you.
