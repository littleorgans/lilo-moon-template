// Row level security is invisible to the two artifacts that describe this schema. Atlas Community
// drops policies from a diff silently, and drizzle-kit pull drops the USING expression from SELECT
// policies. Both exit 0 while doing it. So neither file can be reviewed for correctness, and the
// only honest check is to apply the migrations and observe the database.
//
// Every assertion below has been proven to fail when the protection it names is removed.

import { Client } from "pg";

import { applyMigrations, dockerIsAvailable, withPostgres } from "./lib/postgres-container.mjs";

const failures = [];

// A body returns true to pass, or a string describing what it saw. A throw is a failure and is
// reported as one: a policy that raises instead of returning NULL is a real defect, and a stack
// trace hides which check found it.
async function verify(name, body) {
  let detail;
  try {
    const outcome = await body();
    if (outcome === true) {
      process.stdout.write(`  ok    ${name}\n`);
      return;
    }
    detail = outcome;
  } catch (error) {
    detail = `threw ${error.code ?? ""} ${error.message}`.trim();
  }
  failures.push(`${name}: ${detail}`);
  process.stdout.write(`  FAIL  ${name}\n        ${detail}\n`);
}

// The only shape the application ever uses: one client, one explicit transaction, role and claims
// both transaction-local. packages/db owns the production copy of this sequence.
async function asPrincipal(client, claims, body) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    if (claims !== null) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    const result = await body();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

const column = (result, name) => result.rows.map((row) => row[name]);

if (!process.env.CI && !dockerIsAvailable()) {
  process.stdout.write("RLS verify skipped locally: Docker is unavailable; CI will run it.\n");
  process.exit(0);
}

await withPostgres(async (databaseUrl) => {
  applyMigrations(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Seeding runs as the superuser, which bypasses RLS by design. Nothing below trusts it.
    await client.query("INSERT INTO accounts (workos_org_id) VALUES ('org_AAA'), ('org_BBB')");
    await client.query("INSERT INTO profiles (workos_user_id) VALUES ('user_AAA'), ('user_BBB')");

    const principalA = { sub: "user_AAA", org_id: "org_AAA" };
    const count = async () =>
      Number((await client.query("SELECT count(*)::int AS n FROM accounts")).rows[0].n);

    await verify("accounts are scoped to the org in the claims", async () => {
      const seen = await asPrincipal(client, principalA, async () =>
        column(
          await client.query("SELECT workos_org_id FROM accounts ORDER BY 1"),
          "workos_org_id",
        ),
      );
      return (
        (seen.length === 1 && seen[0] === "org_AAA") ||
        `expected ['org_AAA'], saw ${JSON.stringify(seen)}`
      );
    });

    await verify("profiles are scoped to the subject in the claims", async () => {
      const seen = await asPrincipal(client, principalA, async () =>
        column(
          await client.query("SELECT workos_user_id FROM profiles ORDER BY 1"),
          "workos_user_id",
        ),
      );
      return (
        (seen.length === 1 && seen[0] === "user_AAA") ||
        `expected ['user_AAA'], saw ${JSON.stringify(seen)}`
      );
    });

    await verify("absent claims reveal nothing rather than everything", async () => {
      const seen = await asPrincipal(client, null, count);
      return seen === 0 || `expected 0 rows without claims, saw ${seen}`;
    });

    await verify("an account cannot be created for another org", async () => {
      try {
        await asPrincipal(client, principalA, () =>
          client.query("INSERT INTO accounts (workos_org_id) VALUES ('org_CCC')"),
        );
      } catch (error) {
        return error.code === "42501" || `rejected with ${error.code}, expected 42501`;
      }
      return "insert of org_CCC under org_AAA claims was accepted";
    });

    // The pooling safety property: transaction-local values are gone at COMMIT, so identity
    // cannot leak to the next borrower of a pooled connection.
    await verify("claims do not survive the transaction that set them", async () => {
      const seen = await asPrincipal(client, null, count);
      return seen === 0 || `a later transaction on the same client saw ${seen} rows`;
    });

    // Catches the failure mode nobody notices: a table added to schema.sql with no matching
    // policy migration is readable by every tenant.
    await verify("every table in public has row level security enabled and forced", async () => {
      const unprotected = (
        await client.query(`
          SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname
        `)
      ).rows.filter((row) => !row.enabled || !row.forced);
      return unprotected.length === 0 || `unprotected: ${JSON.stringify(unprotected)}`;
    });
  } finally {
    await client.end();
  }
});

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} row level security check(s) failed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nRow level security verified against the applied migrations.\n");
}
