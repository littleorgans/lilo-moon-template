// Row level security is invisible to the two artifacts that describe this schema. Atlas Community
// drops policies from a diff silently, and drizzle-kit pull drops the USING expression from SELECT
// policies. Both exit 0 while doing it. So neither file can be reviewed for correctness, and the
// only honest check is to apply the migrations and observe the database.
//
// The checks that hold for any schema, and the harness that runs them, come from
// @littleorgans/db-tools, which a consumer runs as `rls-verify` against its own database. This
// script adds only what is specific to this repository's accounts and profiles.
//
// Every assertion below has been proven to fail when the protection it names is removed.

import { asRole, rlsChecks, runChecks } from "@littleorgans/db-tools";
import { Client } from "pg";

import { applyMigrations, dockerIsAvailable, withPostgres } from "./lib/postgres-container.mjs";

const column = (result, name) => result.rows.map((row) => row[name]);
const principalA = { sub: "user_AAA", org_id: "org_AAA" };

function scopedTo(client, sql, name, expected) {
  return async () => {
    const seen = await asRole(client, "authenticated", principalA, async () =>
      column(await client.query(sql), name),
    );
    return (
      (seen.length === 1 && seen[0] === expected) ||
      `expected ['${expected}'], saw ${JSON.stringify(seen)}`
    );
  };
}

if (!process.env.CI && !dockerIsAvailable()) {
  process.stdout.write("RLS verify skipped locally: Docker is unavailable; CI will run it.\n");
  process.exit(0);
}

const failures = await withPostgres("rls-verify", async (databaseUrl) => {
  applyMigrations(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Seeding runs as the superuser, which bypasses RLS by design. Nothing below trusts it. The
    // rows also keep the package's claim checks from passing on empty tables.
    await client.query("INSERT INTO accounts (workos_org_id) VALUES ('org_AAA'), ('org_BBB')");
    await client.query("INSERT INTO profiles (workos_user_id) VALUES ('user_AAA'), ('user_BBB')");

    const repositoryChecks = [
      {
        name: "accounts are scoped to the org in the claims",
        run: scopedTo(
          client,
          "SELECT workos_org_id FROM accounts ORDER BY 1",
          "workos_org_id",
          "org_AAA",
        ),
      },
      {
        name: "profiles are scoped to the subject in the claims",
        run: scopedTo(
          client,
          "SELECT workos_user_id FROM profiles ORDER BY 1",
          "workos_user_id",
          "user_AAA",
        ),
      },
      {
        name: "an account cannot be created for another org",
        async run() {
          try {
            await asRole(client, "authenticated", principalA, () =>
              client.query("INSERT INTO accounts (workos_org_id) VALUES ('org_CCC')"),
            );
          } catch (error) {
            return error.code === "42501" || `rejected with ${error.code}, expected 42501`;
          }
          return "insert of org_CCC under org_AAA claims was accepted";
        },
      },
    ];
    // Repository checks first, so the package's claim checks run on a connection that has
    // already carried claims: the case a pooled connection is in.
    return await runChecks(client, [...repositoryChecks, ...rlsChecks()], (line) =>
      process.stdout.write(line),
    );
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
