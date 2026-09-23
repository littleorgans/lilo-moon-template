import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "pg";

import { emptyTables, quoteIdentifier, rlsChecks, runChecks } from "./checks.js";

export const exitCodes = {
  /** Every check passed. */
  passed: 0,
  /** At least one check failed: row level security is not proven. */
  failed: 1,
  /** The command line or environment is wrong. Nothing was run. */
  usage: 2,
  /** The database could not be reached or prepared, so no check ran to completion. */
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

Exit codes: 0 verified, 1 a check failed, 2 usage error, 3 database unreachable or setup failed.
`;

/** Where the checks ran, without the password or query parameters that can carry secrets. */
function describeTarget(url: URL): string {
  const user = decodeURIComponent(url.username) || "the default user";
  return `${url.hostname}:${url.port || "5432"}${url.pathname} as ${user}`;
}

/** Removes every form of the URL's password from a message a driver or server produced. */
function redact(text: string, url: URL): string {
  const secrets = [url.href, url.password, decodeURIComponent(url.password)].filter(Boolean);
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

async function connect(url: URL): Promise<Client> {
  const client = new Client({ connectionString: url.href, application_name: "rls-verify" });
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

async function verify(options: Options, io: CliIo, mode: string): Promise<number> {
  const client = await connect(options.url);
  try {
    // The guarantee behind "only read": Postgres itself refuses any write for the rest of this
    // session, including from a check.
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await client.query("SET statement_timeout = '60s'");
    await client.query("SET lock_timeout = '5s'");
    const { rows } = await client.query<{ exists: boolean; can_set: boolean }>(
      `SELECT to_regrole($1) IS NOT NULL AS exists,
              to_regrole($1) IS NOT NULL AND pg_has_role(current_user, to_regrole($1), 'SET') AS can_set`,
      [quoteIdentifier(options.role)],
    );
    if (rows[0]?.exists !== true) {
      throw new Error(`role ${options.role} does not exist; apply the migrations first`);
    }
    if (!rows[0].can_set) {
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
    await quietly(client.end());
  }
}

// The only database this writes to is one it created in the same run under a random name, and
// that is the only database it drops. The URL's own database hosts CREATE and DROP DATABASE.
async function verifyDisposable(
  options: Options,
  migrations: string,
  seed: string | undefined,
  io: CliIo,
): Promise<number> {
  const files = sqlFiles(migrations);
  const admin = await connect(options.url);
  const scratch = `rls_verify_${randomBytes(6).toString("hex")}`;
  try {
    await admin.query(`CREATE DATABASE ${scratch}`);
  } catch (error) {
    await quietly(admin.end());
    throw new Error(`could not create a scratch database: ${messageOf(error)}`, { cause: error });
  }
  io.stdout(`rls-verify: created scratch database ${scratch}\n`);
  try {
    const url = new URL(options.url);
    url.pathname = `/${scratch}`;
    const setup = await connect(url);
    try {
      for (const file of [...files, ...(seed === undefined ? [] : [seed])]) {
        // Migrations apply in order, each after the one before it.
        // oxlint-disable-next-line no-await-in-loop
        await runFile(setup, file);
      }
    } finally {
      await quietly(setup.end());
    }
    io.stdout(`rls-verify: applied ${files.length} migrations from ${migrations}\n`);
    return await verify({ ...options, url }, io, "disposable");
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
      io.stdout(`rls-verify: dropped scratch database ${scratch}\n`);
    } catch (error) {
      io.stderr(`rls-verify: could not drop ${scratch}: ${messageOf(error)}\n`);
    } finally {
      await quietly(admin.end());
    }
  }
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
  } catch (error) {
    io.stderr(`rls-verify: ${messageOf(error)}\n\n${usage}`);
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
