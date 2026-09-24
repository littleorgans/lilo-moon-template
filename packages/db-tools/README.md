# @littleorgans/db-tools

The database gates for a project on `@littleorgans/db`, as two commands:

- `rls-verify` proves row level security holds in your own Postgres database. Run it in CI against
  the database your migrations produce, or against a deployed database to check it without
  changing anything.
- `db-tools` runs the rest of the schema workflow against a disposable Postgres in Docker: Atlas
  migration diff, lint and apply, the typed Drizzle schema (`drizzle-generate` writes it,
  `drizzle-check` fails when it is stale), `rls-verify` against a scratch copy of your migrations,
  and `clean`. See [The db-tools command](#the-db-tools-command).

`rls-verify` checks what holds for any schema scoped the way `@littleorgans/db` scopes it:

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
pnpm add -D @littleorgans/db-tools pg drizzle-kit
```

`pg` (`^8.15.0`) is a peer dependency. `drizzle-kit` (`^0.31.0`) is an optional peer, needed only by
`db-tools drizzle-generate` and `drizzle-check`. It is a peer rather than a dependency so that your
project pins the version that generated the committed schema: a different drizzle-kit can print the
same schema differently, and `drizzle-check` would then fail. `@littleorgans/db` is an optional
peer: install it to use its shipped migrations as the default for `--disposable`.

Two tools are not npm packages and must be on `PATH`:

- **Docker**, for every `db-tools` command except `atlas-apply`. `rls-verify` itself never starts a
  container.
- **Atlas**, for the `atlas-*` and `drizzle-*` commands. It is a Go binary with no npm
  distribution. Install it from <https://atlasgo.io/getting-started>, or pin it in `.prototools`
  (`atlas = "1.3.0"` with the plugin line from this repository's `.prototools`) so that
  `proto install` provides the same version locally and in CI.

A missing tool fails with exit 3 and a message that names it, except for the local check skips
described below. A Docker daemon that does not answer `docker info` within 20 seconds counts as unavailable.

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
CREATE never triggers DROP, and a failed DROP returns exit 3 with the scratch name for cleanup. The
admin and migration connections also start read-only, protecting login triggers before any command
runs. The admin connection to the original database is writable only while `CREATE DATABASE` or
`DROP DATABASE` runs, because Postgres refuses both in a read-only session, and is read-only again
straight after. Restoration is attempted even when CREATE or DROP fails. If restoration itself
fails, the CLI returns exit 3 and closes the admin connection; it still attempts to drop any scratch
database already created. Migrations do not run if the reset after CREATE fails. Neither statement
fires the original database's event triggers or writes its tables. The migration connection becomes
writable only after its database name has been checked. The CLI never starts a container.

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

## The db-tools command

```sh
pnpm exec db-tools <command> [options]
```

| Command            | What it does                                                                            | Needs                      |
| ------------------ | --------------------------------------------------------------------------------------- | -------------------------- |
| `atlas-diff`       | Writes a versioned migration that brings `--migrations` to the desired schema (`--to`). | Docker, Atlas              |
| `atlas-lint`       | Lints migrations added since `--git-base` (default `MOON_BASE`), else the latest one.   | Docker, Atlas              |
| `atlas-apply`      | Applies pending migrations to `DATABASE_URL` (or `--url`).                              | Atlas                      |
| `drizzle-generate` | Applies the migrations to a scratch database and writes its typed schema to `--out`.    | Docker, Atlas, drizzle-kit |
| `drizzle-check`    | Generates the schema again and fails if `--out` differs by a byte.                      | Docker, Atlas, drizzle-kit |
| `rls-verify`       | Runs `rls-verify --disposable` with `--migrations` and `--seed` against the container.  | Docker                     |
| `clean`            | Removes the checkout's container.                                                       | Docker, if installed       |

Paths are relative to the working directory. The defaults are the layout the adoption guides set
up:

| Option               | Default                                                        | Used by                           |
| -------------------- | -------------------------------------------------------------- | --------------------------------- |
| `--migrations <dir>` | `db/migrations`                                                | all but `clean`                   |
| `--to <file>`        | `db/schema.sql`                                                | `atlas-diff`                      |
| `--git-base <ref>`   | `MOON_BASE`, else only the latest migration                    | `atlas-lint`                      |
| `--url <url>`        | `DATABASE_URL`                                                 | `atlas-apply`                     |
| `--out <dir>`        | `db/drizzle/_generated`                                        | `drizzle-*`                       |
| `--seed <file>`      | none                                                           | `rls-verify`                      |
| `--schema`, `--role` | as `rls-verify`                                                | `rls-verify`                      |
| `--root <dir>`       | nearest ancestor with `pnpm-workspace.yaml`, `.moon` or `.git` | every container command           |
| `--port <port>`      | `LILO_PG_PORT`, else derived from `--root`                     | container commands except `clean` |
| `--image <image>`    | `postgres:17-alpine`                                           | container commands except `clean` |

A command refuses an option it does not use, so a misplaced flag is an error, not ignored.

The generated schema starts with a header saying it is generated and that its policies are not a
faithful record: `drizzle-kit pull` drops the `USING` expression from SELECT policies. `rls-verify`
is the authority on row level security. Only `schema.ts` is kept; drizzle-kit's SQL snapshot,
journal and relations are discarded.

### The container

Each checkout owns one container, named `baseline-postgres-<digest>` after the checkout's absolute
path, with a host port derived from the same digest and bound to `127.0.0.1`. Separate clones and
worktrees therefore get separate containers and ports. Each helper call creates its own database
inside it, named after the command, process id and a random suffix, and drops it afterwards.
Interrupted calls leave their databases behind; the next call with the same label drops only
databases bearing this checkout's scratch ownership comment whose process no longer exists.
A matching name without that comment is preserved. The standalone
`rls-verify --disposable` lifecycle remains separate.

The digest locates the container for a checkout path; it is not evidence that the container is
safe to delete. New containers carry an `org.littleorgans.db-tools.root` label declaring them
managed scratch space for that path, so
`docker ps --all --filter label=org.littleorgans.db-tools.root --format '{{.Names}} {{.Label "org.littleorgans.db-tools.root"}}'`
shows which checkout, possibly deleted, each container belongs to. Containers made by this
repository's old root scripts have the same name, image and binding but no label. They can still
host new scratch databases, so existing database gates keep working. `clean` and image replacement
refuse to delete an unlabelled container, and print the `docker rm --force <name>` command that
removes it when nothing in it is needed.
A label naming another checkout is always refused. Start, replacement and removal act on the
inspected container ID, so a name reassigned in the meantime cannot redirect them.

Labels are safeguards against accidental deletion, not a security boundary against Docker admins.
Ownership is scoped to the absolute path, not a Git checkout generation. Recreating a checkout at
the same path reuses its managed scratch container; preserve any valuable data outside it.

Set `LILO_PG_PORT` (or `--port`) when the derived port is taken. The container keeps the port it
was created with, so run `db-tools clean` before you change it; a mismatch fails with that advice.
The superuser password is `postgres`, which is why the port is bound to the loopback address only.

Prefer `DATABASE_URL` to `--url` to keep credentials out of shell history. Command diagnostics and
child-tool output redact the URL, and its password wherever it is reprinted as a credential
(`:<password>@` or quoted/unquoted `password=<password>`, including URL-encoded forms). Atlas still receives the URL as a process
argument; use the same host access controls as when invoking Atlas directly.

### Checks, CI and exit codes

`atlas-lint`, `drizzle-check` and `rls-verify` are checks. When Docker is unavailable and `CI` is
not set, they print why and exit 0, so a laptop without Docker can still run the other gates. When
`CI` is set, they fail with exit 3. The other commands always need what they need.

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | Done, or a check skipped locally without Docker.            |
| 1    | A check failed, or Atlas or drizzle-kit reported a failure. |
| 2    | Usage error: unknown command or option, or a missing URL.   |
| 3    | Docker, Atlas or drizzle-kit is missing, or setup failed.   |

### From Moon

Run the commands from root tasks and skip them when the project has no schema:

```yaml
tasks:
  drizzle-check:
    type: "test"
    command: "db-tools drizzle-check"
    inputs:
      - "db/**/*"
    checks:
      - check: "condition"
        script: "test ! -f db/schema.sql"
    options:
      shell: false
      cache: false
      runInCI: "always"
```

The database is not a file input, so `cache: false` keeps a cached pass from standing in for a real
run.

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

The Postgres container is available to tests the same way:

```ts
import {
  applyMigrations,
  dockerIsAvailable,
  psqlInput,
  withPostgres,
} from "@littleorgans/db-tools";
import { describe, it } from "vitest";

describe.skipIf(!dockerIsAvailable())("against Postgres", () => {
  it("applies the migrations", async () => {
    await withPostgres("my-test", async (databaseUrl) => {
      applyMigrations(databaseUrl, "db/migrations");
      psqlInput(databaseUrl, "INSERT INTO accounts (workos_org_id) VALUES ('org_a');");
      // ...connect with pg and assert
    });
  });
});
```

`withPostgres(label, callback, options?)` hands the callback a superuser URL to a fresh database
named `<label>_<pid>_<nonce>` in the checkout's container, and drops it afterwards. `startPostgres` returns a
URL to the container's `postgres` database for tools that create their own. `psqlInput` runs SQL
through the container's `psql` with `ON_ERROR_STOP` in one transaction, with `--set` variables, so
no host `psql` is needed; a failure, including psql exiting before it reads the SQL, reports psql's
exit status and stderr. It checks the inspected image and binding and accepts only a URL for the
checkout's loopback server, rather than silently ignoring a different host or port. `applyMigrations` runs `atlas migrate apply`. `dockerStatus` says whether
Docker answers and why not, and `removePostgres` is `db-tools clean`. Each takes the `root`, `port`,
`image` and `env` options the command line exposes.
