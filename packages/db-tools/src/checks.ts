/**
 * The slice of a Postgres client the checks need. Declared structurally so a caller passes a `pg`
 * Client and a test passes anything that answers queries.
 */
export interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** `true` is a pass. A string is a failure, and says what the check saw. */
export type Outcome = true | string;

export interface RlsCheck {
  readonly name: string;
  run(client: Queryable): Promise<Outcome>;
}

export interface RlsCheckOptions {
  /** Schemas whose tables must be protected. Defaults to `public`. */
  readonly schemas?: readonly string[];
  /** The role requests run as. Defaults to `authenticated`, the role @littleorgans/db uses. */
  readonly role?: string;
}

interface Table {
  readonly qualified: string;
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly readable: boolean;
}

export const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * Runs `body` in one transaction as `role`, with `claims` set the way @littleorgans/db sets them,
 * and always rolls back. Callers own connection safety: rollback does not undo nontransactional
 * effects such as sequence increments or external actions by server functions.
 */
export async function asRole<T>(
  client: Queryable,
  role: string,
  claims: Readonly<Record<string, unknown>> | null,
  body: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  let result: T;
  try {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    if (claims !== null) {
      // Qualified, because the caller's search_path may put a look-alike ahead of pg_catalog.
      await client.query("SELECT pg_catalog.set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    result = await body();
  } catch (error) {
    // A failed ROLLBACK must not replace the error that caused it.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await client.query("ROLLBACK");
  return result;
}

async function listTables(
  client: Queryable,
  schemas: readonly string[],
  role: string,
): Promise<Table[]> {
  // Partitioned parents and partitions both count: a partition queried directly applies only its
  // own policies.
  const { rows } = await client.query(
    `SELECT format('%I.%I', n.nspname, c.relname) AS qualified,
            c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            has_table_privilege($2, c.oid, 'SELECT') AS readable
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
    [schemas, role],
  );
  return rows.map((row) => ({
    qualified: String(row["qualified"]),
    enabled: row["enabled"] === true,
    forced: row["forced"] === true,
    readable: row["readable"] === true,
  }));
}

// A table the role cannot SELECT reveals nothing to it, so only readable tables are queried. One
// visible row is enough to fail, so no table is scanned past its first row. A client runs queued
// queries one at a time, so these stay inside the transaction asRole opened.
async function rowsWithoutClaims(
  client: Queryable,
  schemas: readonly string[],
  role: string,
): Promise<Outcome> {
  const tables = (await listTables(client, schemas, role)).filter((table) => table.readable);
  const visible = await asRole(client, role, null, async () => {
    const found: string[] = [];
    for (const table of tables) {
      // One connection, one query at a time, including for callers using a raw pg Client.
      // oxlint-disable-next-line no-await-in-loop
      const { rows } = await client.query(`SELECT 1 FROM ${table.qualified} LIMIT 1`);
      if (rows.length > 0) found.push(table.qualified);
    }
    return found;
  });
  return visible.length === 0 || `rows visible without claims in ${visible.join(", ")}`;
}

/**
 * The checks that hold for any schema scoped the way @littleorgans/db scopes it. Schema-specific
 * assertions, such as which tenant sees which row, belong to the project that owns the schema.
 *
 * The two claim checks prove something only for tables that hold rows. See `emptyTables`.
 */
export function rlsChecks(options: RlsCheckOptions = {}): RlsCheck[] {
  const schemas = options.schemas ?? ["public"];
  const role = options.role ?? "authenticated";
  const listed = schemas.join(", ");
  return [
    {
      name: `role ${role} cannot bypass row level security`,
      async run(client) {
        const { rows } = await client.query(
          "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
          [role],
        );
        const found = rows[0];
        if (found === undefined) return `role ${role} does not exist`;
        if (found["rolsuper"] === true) return `${role} is a superuser, so no policy applies to it`;
        return (
          found["rolbypassrls"] !== true || `${role} has BYPASSRLS, so no policy applies to it`
        );
      },
    },
    {
      name: `every table in ${listed} has row level security enabled and forced`,
      async run(client) {
        const tables = await listTables(client, schemas, role);
        if (tables.length === 0) return `no tables in ${listed}, so nothing was verified`;
        const open = tables
          .filter((table) => !table.enabled || !table.forced)
          .map((table) => `${table.qualified} (${table.enabled ? "not forced" : "not enabled"})`);
        return open.length === 0 || `unprotected: ${open.join(", ")}`;
      },
    },
    {
      name: "absent claims reveal no rows",
      run: async (client) => await rowsWithoutClaims(client, schemas, role),
    },
    // The pooling property. A transaction-local setting reverts to an empty string, not to unset,
    // so a policy that casts the claims without nullif() raises on the next borrower instead of
    // matching nothing.
    {
      name: "claims do not survive the transaction that set them",
      async run(client) {
        await asRole(client, role, { sub: "rls-verify", org_id: "rls-verify" }, async () => {
          /* setting the claims is the point */
        });
        return await rowsWithoutClaims(client, schemas, role);
      },
    },
  ];
}

/**
 * Tables with no rows at all, or `null` when the connected user is itself subject to row level
 * security and so cannot tell an empty table from a scoped one. On an empty table the claim checks
 * pass without proving anything.
 */
export async function emptyTables(
  client: Queryable,
  schemas: readonly string[] = ["public"],
): Promise<string[] | null> {
  const { rows } = await client.query(
    "SELECT rolname, rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user",
  );
  const user = rows[0];
  if (user?.["bypasses"] !== true) return null;
  const tables = await listTables(client, schemas, String(user["rolname"]));
  const empty: string[] = [];
  for (const table of tables) {
    // oxlint-disable-next-line no-await-in-loop
    const { rows: found } = await client.query(`SELECT 1 FROM ${table.qualified} LIMIT 1`);
    if (found.length === 0) empty.push(table.qualified);
  }
  return empty;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `threw ${String(error)}`;
  const code = "code" in error ? error.code : undefined;
  return `threw ${typeof code === "string" ? `${code} ` : ""}${error.message}`;
}

/**
 * Runs checks in order and returns observed failures. Policy/data errors are check failures;
 * unexpected errors propagate with the check name so the CLI can distinguish an incomplete run.
 */
export async function runChecks(
  client: Queryable,
  checks: readonly RlsCheck[],
  write: (line: string) => void,
): Promise<string[]> {
  const failures: string[] = [];
  for (const check of checks) {
    let detail: string;
    try {
      // Checks share one client and each opens and rolls back its own transaction, so two must
      // never overlap.
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await check.run(client);
      if (outcome === true) {
        write(`  ok    ${check.name}\n`);
        continue;
      }
      detail = outcome;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      // Policy expression errors, denied access, and attempted writes are observed check failures.
      // Transport failures, timeouts, and programming errors mean verification did not finish.
      if (typeof code !== "string" || !/^(22[0-9A-Z]{3}|42501|25006|P0001)$/u.test(code)) {
        throw new Error(`${check.name}: ${describeError(error)}`, { cause: error });
      }
      detail = describeError(error);
    }
    failures.push(`${check.name}: ${detail}`);
    write(`  FAIL  ${check.name}\n        ${detail}\n`);
  }
  return failures;
}
