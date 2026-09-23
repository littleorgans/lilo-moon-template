# @littleorgans/db-tools

`rls-verify` proves row level security holds in your own Postgres database. Run it in CI against
the database your migrations produce, or against a deployed database to check it without
changing anything.

It checks what holds for any schema scoped the way `@littleorgans/db` scopes it:

- the request role (`authenticated`) is not a superuser and has no `BYPASSRLS`;
- every table in the checked schemas has row level security enabled and forced;
- a transaction without claims sees no rows;
- claims set in one transaction are gone in the next one on the same connection, and the policies
  still return nothing rather than raising.

Which tenant sees which row depends on your schema, so those assertions stay in your project. The
API below runs them next to these.

Requires PostgreSQL 16 or later and Node.js 24.19 or later.

## Install

```sh
pnpm add -D @littleorgans/db-tools pg
```

`pg` (`^8.15.0`) is a peer dependency. `@littleorgans/db` is an optional peer: install it to use
its shipped migrations as the default for `--disposable`.

## Verify an existing database

```sh
DATABASE_URL=postgres://… pnpm exec rls-verify
```

This only reads. The session is read-only before any check runs, so Postgres refuses every write,
including one a policy function attempts, and every transaction is rolled back. Statements time out
after 60 seconds, and waits for a lock after 5.

Connect as a user that can `SET ROLE authenticated`: a superuser, the migration owner, or a login
role granted with `@littleorgans/db`'s `grants/login-role.sql`. The tool stops before any check
if it cannot.

The claim checks prove something only for tables that hold rows. When the connected user can
bypass row level security, the output names the empty tables. When it cannot, the output says it
cannot tell.

## Verify a scratch copy

```sh
DATABASE_URL=postgres://postgres:…@localhost:5432/postgres \
  pnpm exec rls-verify --disposable --migrations db/migrations --seed db/rls-seed.sql
```

`--disposable` creates a database with a random `rls_verify_` name on the same server, applies the
migrations to it in file-name order, runs the seed, verifies it, and drops it, even when a step
fails. The database named in the URL is used only to create and drop that one database, and is
never written. The user needs `CREATEDB`.

Without `--migrations`, the migrations shipped in `@littleorgans/db` are applied. Without
`--seed`, every table is empty and the claim checks are vacuous, so a seed with at least one row
per table makes them count. `--migrations` and `--seed` are refused without `--disposable`.

## Options

| Option               | Default                       | Meaning                                          |
| -------------------- | ----------------------------- | ------------------------------------------------ |
| `--url <url>`        | `DATABASE_URL`                | The database, or the server with `--disposable`. |
| `--schema <name>`    | `public`                      | Schema to check. Repeat for several.             |
| `--role <name>`      | `authenticated`               | The role requests run as.                        |
| `--disposable`       | off                           | Verify a scratch database instead.               |
| `--migrations <dir>` | `@littleorgans/db` migrations | With `--disposable`: `.sql` files to apply.      |
| `--seed <file>`      | none                          | With `--disposable`: SQL run after them.         |

Prefer `DATABASE_URL` to `--url`: a command-line argument shows up in process listings and shell
history.

## Output and exit codes

Each check prints `ok` or `FAIL` with what it saw:

```text
rls-verify: db.internal:5432/app as orders_api (read-only), role authenticated, schemas public
  ok    role authenticated cannot bypass row level security
  FAIL  every table in public has row level security enabled and forced
        unprotected: public.invoices (not forced)
  ok    absent claims reveal no rows
  ok    claims do not survive the transaction that set them
rls-verify: 1 of 4 checks failed.
```

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | Every check passed.                                                      |
| 1    | A check failed: row level security is not proven.                        |
| 2    | Usage error: unknown option, no URL, or a URL that is not `postgres://`. |
| 3    | Setup failed: unreachable database, missing role, grant, or migration.   |

Output names the host, port, database and user, never the password. The URL is not echoed, even
when it is rejected.

## Use it from code

```ts
import { asRole, rlsChecks, runChecks } from "@littleorgans/db-tools";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const failures = await runChecks(
  client,
  [
    {
      name: "orders are scoped to the org in the claims",
      async run(db) {
        const rows = await asRole(
          db,
          "authenticated",
          { org_id: "org_a" },
          async () => (await db.query("SELECT org_id FROM orders")).rows,
        );
        return rows.every((row) => row["org_id"] === "org_a") || "saw another org's orders";
      },
    },
    ...rlsChecks(),
  ],
  (line) => process.stdout.write(line),
);
await client.end();
process.exitCode = failures.length === 0 ? 0 : 1;
```

`asRole` runs its body in one transaction as the role with the claims set, and always rolls back.
A check returns `true` to pass or a string saying what it saw. A check that throws is reported as a
failure.
