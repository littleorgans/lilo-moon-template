import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "pg";

import { emptyTables, quoteIdentifier, rlsChecks, runChecks } from "./checks.js";
import type { Queryable } from "./checks.js";

export const exitCodes = {
  /** Every check passed. */
  passed: 0,
  /** At least one check failed: row level security is not proven. */
  failed: 1,
  /** The command line or environment is wrong. Nothing was run. */
  usage: 2,
  /** Verification or cleanup could not finish, including unexpected errors. */
  setup: 3,
} as const;

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const usage = `Usage: rls-verify [options]

Proves row level security holds in a Postgres database: the request role cannot bypass it, every
table has it enabled and forced, and absent or expired claims reveal no rows.

Options:
  --url <url>          Database URL. Defaults to DATABASE_URL, which keeps it out of shell history.
  --schema <name>      Schema whose tables must be protected. Repeatable. Default: public.
  --role <name>        Role requests run as. Default: authenticated.
  --disposable         Create a scratch database on the same server, apply migrations to it, verify
                       it, and drop it. The database in the URL is never written.
  --migrations <dir>   With --disposable: .sql files applied in file-name order. Default: the
                       migrations shipped in @littleorgans/db.
  --seed <file>        With --disposable: SQL run after the migrations, to give tables rows.
  -h, --help           Show this help.

Without --disposable the database is only read: every transaction is read-only and rolled back.

Exit codes: 0 verified, 1 a check failed, 2 usage error, 3 verification or cleanup incomplete.
`;

/** Where the checks ran, without the password or query parameters that can carry secrets. */
function describeTarget(url: URL): string {
  const user = decode(url.username) || "the default user";
  return `${url.hostname}:${url.port || "5432"}${url.pathname} as ${user}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Removes every form of the URL's password from a message a driver or server produced. */
function redact(text: string, url: URL): string {
  const secrets = [
    url.href,
    url.password,
    decode(url.password),
    ...url.searchParams.getAll("password"),
  ].filter(Boolean);
  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "***"), text);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Cleanup that must not replace the error already in flight. */
async function quietly(cleanup: Promise<unknown>): Promise<void> {
  try {
    await cleanup;
  } catch {
    /* the original error is the one worth reporting */
  }
}

function sqlFiles(directory: string): string[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();
  if (files.length === 0) throw new Error(`no .sql files in ${directory}`);
  return files.map((file) => join(directory, file));
}

// The export map exposes files, not the directory. atlas.sum always ships beside the SQL.
function shippedMigrations(): string {
  try {
    return dirname(fileURLToPath(import.meta.resolve("@littleorgans/db/migrations/atlas.sum")));
  } catch {
    throw new Error("@littleorgans/db is not installed; pass --migrations <dir>");
  }
}

// A startup parameter, so the session is read-only before any code of the database's runs,
// including a login event trigger. Appended, so a -c already in the URL cannot switch it back off.
function readOnlyAtStartup(url: URL): URL {
  const readOnly = new URL(url);
  // Match pg: the last URL value wins, with an empty/missing value falling back to PGOPTIONS.
  const inherited = url.searchParams.getAll("options").at(-1) || process.env["PGOPTIONS"];
  const options = [inherited, "-c default_transaction_read_only=on"];
  readOnly.searchParams.set("options", options.filter(Boolean).join(" "));
  return readOnly;
}

async function connect(url: URL): Promise<Client> {
  const client = new Client({
    connectionString: url.href,
    application_name: "rls-verify",
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection failure is reported by the next query, not an uncaught EventEmitter error.
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    await quietly(client.end());
    throw new Error(`could not connect: ${messageOf(error)}`, { cause: error });
  }
  return client;
}

async function runFile(client: Client, file: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(readFileSync(file, "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await quietly(client.query("ROLLBACK"));
    throw new Error(`${file} failed: ${messageOf(error)}`, { cause: error });
  }
}

interface Options {
  readonly url: URL;
  readonly schemas: readonly string[];
  readonly role: string;
}

// Every query, including catalog reads and empty-table diagnostics, runs inside an explicit
// read-only transaction. A function may change session defaults; rollback and the next BEGIN
// READ ONLY prevent that from weakening a later query.
//
// Catalog reads pin search_path, so no database object can stand in for a catalog the checks read.
// The claim checks' own transactions (asRole's BEGIN) keep the session's search_path: their
// statements are schema-qualified, and the policy functions they execute must resolve names the
// way they do for the application, or an unqualified table in one fails the run.
function readOnlyClient(connection: Client): Queryable {
  let inTransaction = false;
  let pending: Promise<unknown> = Promise.resolve();
  const begin = async (pinned: boolean) => {
    await connection.query("BEGIN READ ONLY");
    if (pinned) await connection.query("SET LOCAL search_path = pg_catalog, pg_temp");
    await connection.query("SET LOCAL statement_timeout = '60s'");
    await connection.query("SET LOCAL lock_timeout = '5s'");
  };
  return {
    query(text, values) {
      const execute = async () => {
        if (text === "BEGIN") {
          await begin(false);
          inTransaction = true;
          return { rows: [] };
        }
        if (text === "ROLLBACK") {
          inTransaction = false;
          return await connection.query(text);
        }
        if (inTransaction)
          return await connection.query(text, values === undefined ? undefined : [...values]);
        try {
          await begin(true);
          return await connection.query(text, values === undefined ? undefined : [...values]);
        } finally {
          await connection.query("ROLLBACK");
        }
      };
      const previous = pending;
      const result = (async () => {
        await previous;
        return await execute();
      })();
      pending = quietly(result);
      return result;
    },
  };
}

async function verify(options: Options, io: CliIo, mode: string): Promise<number> {
  const connection = await connect(readOnlyAtStartup(options.url));
  const client = readOnlyClient(connection);
  try {
    const { rows } = await client.query(
      `SELECT to_regrole($1) IS NOT NULL AS exists,
              to_regrole($1) IS NOT NULL AND pg_has_role(current_user, to_regrole($1), 'SET') AS can_set`,
      [quoteIdentifier(options.role)],
    );
    if (rows[0]?.["exists"] !== true) {
      throw new Error(`role ${options.role} does not exist; apply the migrations first`);
    }
    if (!rows[0]["can_set"]) {
      throw new Error(
        `the connected user cannot SET ROLE ${options.role}; grant it, for example with @littleorgans/db's grants/login-role.sql`,
      );
    }
    io.stdout(
      `rls-verify: ${describeTarget(options.url)} (${mode}), role ${options.role}, schemas ${options.schemas.join(", ")}\n`,
    );
    const checks = rlsChecks({ schemas: options.schemas, role: options.role });
    const failures = await runChecks(client, checks, io.stdout);
    const empty = await emptyTables(client, options.schemas);
    if (empty === null) {
      io.stdout(
        "  note  the connected user is subject to row level security, so an empty table cannot be told from a scoped one\n",
      );
    } else if (empty.length > 0) {
      io.stdout(`  note  empty tables prove nothing for the claim checks: ${empty.join(", ")}\n`);
    }
    if (failures.length > 0) {
      io.stderr(`rls-verify: ${failures.length} of ${checks.length} checks failed.\n`);
      return exitCodes.failed;
    }
    io.stdout(`rls-verify: row level security verified, ${checks.length} checks passed.\n`);
    return exitCodes.passed;
  } finally {
    await quietly(connection.end());
  }
}

// The only database this writes to is one it created in the same run under a random name, and
// that is the only database it drops. The URL's own database hosts CREATE and DROP DATABASE.
// CREATE and DROP DATABASE are refused in a read-only session and cannot run inside a transaction
// block that could be made writable instead. So the connection to the original database becomes
// writable for exactly one of those statements at a time, and read-only again straight after.
// Neither fires the original database's event triggers or writes its tables.
async function writableFor(admin: Client, statement: string): Promise<void> {
  await admin.query("SET default_transaction_read_only = off");
  try {
    await admin.query(statement);
  } finally {
    await quietly(admin.query("SET default_transaction_read_only = on"));
  }
}

async function verifyDisposable(
  options: Options,
  migrations: string,
  seed: string | undefined,
  io: CliIo,
): Promise<number> {
  const files = sqlFiles(migrations);
  const admin = await connect(readOnlyAtStartup(options.url));
  const scratch = `rls_verify_${randomBytes(12).toString("hex")}`;
  try {
    // Startup keeps the original database's login triggers read-only. No migration runs here.
    await admin.query("SET statement_timeout = '60s'");
    await admin.query("SET lock_timeout = '5s'");
    await writableFor(admin, `CREATE DATABASE ${quoteIdentifier(scratch)}`);
  } catch (error) {
    await quietly(admin.end());
    throw new Error(`could not create a scratch database: ${messageOf(error)}`, { cause: error });
  }
  let result: number = exitCodes.setup;
  let failure: unknown;
  try {
    io.stdout(`rls-verify: created scratch database ${scratch}\n`);
    const url = new URL(options.url);
    url.pathname = `/${scratch}`;
    const setup = await connect(readOnlyAtStartup(url));
    try {
      const { rows } = await setup.query("SELECT pg_catalog.current_database() AS name");
      if (rows[0]?.name !== scratch)
        throw new Error("scratch connection reached the wrong database");
      await setup.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE");
      await setup.query("SET statement_timeout = '60s'");
      await setup.query("SET lock_timeout = '5s'");
      for (const file of [...files, ...(seed === undefined ? [] : [seed])]) {
        // Migrations apply in order, each after the one before it.
        // oxlint-disable-next-line no-await-in-loop
        await runFile(setup, file);
      }
    } finally {
      await quietly(setup.end());
    }
    io.stdout(`rls-verify: applied ${files.length} migrations from ${migrations}\n`);
    result = await verify({ ...options, url }, io, "disposable");
  } catch (error) {
    failure = error;
  }
  try {
    await writableFor(admin, `DROP DATABASE ${quoteIdentifier(scratch)} WITH (FORCE)`);
    io.stdout(`rls-verify: dropped scratch database ${scratch}\n`);
  } catch (error) {
    const prior = failure === undefined ? "" : `${messageOf(failure)}; `;
    failure = new Error(`${prior}could not drop ${scratch}: ${messageOf(error)}`, { cause: error });
  } finally {
    await quietly(admin.end());
  }
  if (failure !== undefined) throw failure;
  return result;
}

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        url: { type: "string" },
        schema: { type: "string", multiple: true },
        role: { type: "string" },
        disposable: { type: "boolean" },
        migrations: { type: "string" },
        seed: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch {
    io.stderr(`rls-verify: invalid command-line options.\n\n${usage}`);
    return exitCodes.usage;
  }
  if (values.help === true) {
    io.stdout(usage);
    return exitCodes.passed;
  }
  const raw = values.url ?? io.env["DATABASE_URL"];
  if (raw === undefined || raw === "") {
    io.stderr("rls-verify: set DATABASE_URL or pass --url.\n");
    return exitCodes.usage;
  }
  // Never echo the value: it holds a password.
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url === null || !["postgres:", "postgresql:"].includes(url.protocol)) {
    io.stderr("rls-verify: the database URL must be a postgres:// or postgresql:// URL.\n");
    return exitCodes.usage;
  }
  if (values.disposable !== true && (values.migrations ?? values.seed) !== undefined) {
    io.stderr("rls-verify: --migrations and --seed write, so they need --disposable.\n");
    return exitCodes.usage;
  }
  const originalIo = io;
  const sanitize = (text: string) => {
    const safe = redact(text, url);
    const password = io.env["PGPASSWORD"];
    return password ? safe.replaceAll(password, "***") : safe;
  };
  io = {
    ...io,
    stdout: (text) => originalIo.stdout(sanitize(text)),
    stderr: (text) => originalIo.stderr(sanitize(text)),
  };
  const options = {
    url,
    schemas: values.schema ?? ["public"],
    role: values.role ?? "authenticated",
  };
  try {
    return values.disposable === true
      ? await verifyDisposable(options, values.migrations ?? shippedMigrations(), values.seed, io)
      : await verify(options, io, "read-only");
  } catch (error) {
    // Anything that stops the checks from finishing is a setup failure, never a failed check: exit
    // 1 means row level security was observed to be broken.
    io.stderr(`rls-verify: ${redact(messageOf(error), url)}\n`);
    return exitCodes.setup;
  }
}
