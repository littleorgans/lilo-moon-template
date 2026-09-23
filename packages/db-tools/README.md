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

The session is read-only from its startup parameters, so it is read-only before any code of the
database's runs. On Postgres 17 that includes login event triggers: a trigger that writes makes the
connection fail with exit 3 instead of writing. Then every verification query runs inside an
explicit `BEGIN READ ONLY` transaction that is rolled back, including catalog reads and empty-table
diagnostics. Writes from policy functions, including `SECURITY DEFINER` ones, are refused, and a
function that changes session defaults cannot make a later transaction writable. Statements time
out after 60 seconds, lock waits after 5, and connections after 10.

The startup parameter travels in the connection's `options`, appended after the effective user
options: the last URL `options` value, or `PGOPTIONS` if that value is empty or absent. Connect
directly to Postgres. A pooler may reject `options`; configuring it to ignore them silently removes
the startup protection and is not a supported workaround.

Catalog reads pin `search_path` to `pg_catalog, pg_temp`, so no database object can stand in for a
catalog the checks read. The claim checks keep the session's `search_path`, so a policy function
resolves unqualified names the way it does for the application. Every statement the tool sends in
them is schema-qualified.

Use a trusted server and a least-privilege login. READ ONLY is a Postgres transaction property, not
a sandbox for server code. A function a policy calls can still act outside the transaction: open a
new connection with `dblink` or `postgres_fdw` and write through it, run `COPY ... TO PROGRAM`, or
write files. Those effects are outside this guarantee. The CLI does not execute custom SQL or `DO`
blocks in existing-database mode.

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
fails. The database named in the URL hosts only the administrative connection for CREATE/DROP;
migrations and seed SQL are sent only after confirming the new connection's database name. A failed
CREATE never triggers DROP, and a failed DROP returns exit 3 with the scratch name for cleanup.
The admin and migration connections also start read-only, protecting login triggers before any
command runs. The admin connection to the original database is writable only while `CREATE
DATABASE` or `DROP DATABASE` runs, because Postgres refuses both in a read-only session, and is
read-only again straight after. Neither statement fires the original database's event triggers or
writes its tables. The migration connection becomes writable only after its database name has been
checked. The CLI never starts a container.

The login needs `CREATEDB`, permission to `SET ROLE` the checked role, and whatever privileges the
chosen migrations need. The shipped migrations also need `CREATEROLE` (or a superuser). They create
cluster-wide `authenticated`; dropping the scratch database does **not** drop that role. Apply only
trusted migrations and seeds: arbitrary SQL can change roles or invoke extensions with effects
outside the scratch database. For full isolation, supply a separate disposable Postgres server.

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

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| 0    | Every check passed.                                                                       |
| 1    | A check failed: row level security is not proven.                                         |
| 2    | Usage error: unknown option, no URL, or a URL that is not `postgres://`.                  |
| 3    | Verification incomplete: connection/setup, unexpected error, timeout, or cleanup failure. |

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

`asRole` runs its body in one transaction as the role with the claims set, and always rolls back. A
check returns `true` to pass or a string saying what it saw. Policy data errors (`22xxx`), denied
access (`42501`), read-only write attempts (`25006`), and policy exceptions (`P0001`) are reported
as check failures. Other thrown errors propagate with the check name; the CLI maps them to exit 3.

The API runs on the client the caller supplies. `asRole` rolls back but intentionally permits write
probes, such as testing that an INSERT is rejected by RLS. The CLI's read-only transaction wrapper
is separate; callers of the API own connection privileges, transaction safety, and output redaction.
