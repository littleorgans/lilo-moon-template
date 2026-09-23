// Plain JavaScript for the same reason as packages/db's integration test: it reuses the repo's one
// Postgres container helper from outside this project. It calls main() in-process so coverage sees
// the command line; root:consumer-check runs the packed bin.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  applyMigrations,
  dockerIsAvailable,
  withPostgres,
} from "../../../../scripts/lib/postgres-container.mjs";
import { exitCodes, main } from "../../src/index.js";

async function run(argv, databaseUrl) {
  let output = "";
  const write = (text) => (output += text);
  const code = await main(argv, {
    env: { DATABASE_URL: databaseUrl },
    stdout: write,
    stderr: write,
  });
  return { code, output };
}

async function sql(databaseUrl, text) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await client.query(text);
  } finally {
    await client.end();
  }
}

const seeded = "INSERT INTO accounts (workos_org_id) VALUES ('org_a'), ('org_b');";

// A migrated database with rows, so the claim checks are not vacuous.
async function withMigrated(body) {
  await withPostgres("db-tools-test", async (databaseUrl) => {
    applyMigrations(databaseUrl);
    await sql(databaseUrl, seeded);
    await body(databaseUrl);
  });
}

async function scratchExists(databaseUrl, output) {
  const name = /created scratch database (rls_verify_[0-9a-f]+)/u.exec(output)?.[1];
  expect(name).toBeDefined();
  const { rows } = await sql(databaseUrl, `SELECT 1 FROM pg_database WHERE datname = '${name}'`);
  return rows.length > 0;
}

describe.skipIf(!dockerIsAvailable())("rls-verify against Postgres", () => {
  it("verifies a migrated database read-only", async () => {
    await withMigrated(async (databaseUrl) => {
      const { code, output } = await run([], databaseUrl);
      expect(output).toContain("(read-only)");
      expect(output.match(/^ {2}ok {4}/gmu)).toHaveLength(4);
      expect(output).toContain("empty tables prove nothing for the claim checks: public.profiles");
      expect(code).toBe(exitCodes.passed);
    });
  }, 60_000);

  it("fails when a table is not forced", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(databaseUrl, "ALTER TABLE profiles NO FORCE ROW LEVEL SECURITY");
      const { code, output } = await run([], databaseUrl);
      expect(output).toContain("unprotected: public.profiles (not forced)");
      expect(code).toBe(exitCodes.failed);
    });
  }, 60_000);

  it("fails when a policy lets rows through without claims", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(databaseUrl, "CREATE POLICY open_read ON accounts FOR SELECT USING (true)");
      const { code, output } = await run([], databaseUrl);
      expect(output).toContain("rows visible without claims in public.accounts");
      expect(code).toBe(exitCodes.failed);
    });
  }, 60_000);

  // A policy that writes on every row it evaluates. Without the read-only session the claim checks
  // would insert into the audit table; with it, Postgres refuses and the table stays empty.
  it("cannot write, even through a function a policy calls", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE TABLE audit (at timestamptz DEFAULT now());
         CREATE FUNCTION app.audited() RETURNS boolean LANGUAGE sql SECURITY DEFINER
           AS $$ INSERT INTO public.audit DEFAULT VALUES; SELECT false $$;
         GRANT EXECUTE ON FUNCTION app.audited() TO authenticated;
         CREATE POLICY audited ON accounts FOR SELECT USING (app.audited());`,
      );
      const { code, output } = await run(["--schema", "public"], databaseUrl);
      expect(output).toContain("read-only transaction");
      expect(code).toBe(exitCodes.failed);
      expect((await sql(databaseUrl, "SELECT count(*)::int AS n FROM audit")).rows[0].n).toBe(0);
    });
  }, 60_000);

  it("stops before any check when the connected user cannot switch to the role", async () => {
    await withMigrated(async (databaseUrl) => {
      const role = `ungranted_${process.pid}`;
      await sql(databaseUrl, `CREATE ROLE ${role} LOGIN PASSWORD 'ungranted-secret'`);
      try {
        const url = new URL(databaseUrl);
        url.username = role;
        url.password = "ungranted-secret";
        const { code, output } = await run([], url.href);
        expect(output).toContain(`cannot SET ROLE authenticated`);
        expect(output).not.toContain("ungranted-secret");
        expect(output).not.toMatch(/^ {2}(ok|FAIL)/mu);
        expect(code).toBe(exitCodes.setup);
      } finally {
        await sql(databaseUrl, `DROP ROLE ${role}`);
      }
    });
  }, 60_000);

  it("stops when the role does not exist", async () => {
    await withMigrated(async (databaseUrl) => {
      const { code, output } = await run(["--role", "no_such_role"], databaseUrl);
      expect(output).toContain("role no_such_role does not exist");
      expect(code).toBe(exitCodes.setup);
    });
  }, 60_000);

  it("applies the shipped migrations and a seed to a scratch database, then drops it", async () => {
    await withPostgres("db-tools-test", async (databaseUrl) => {
      const seed = join(mkdtempSync(join(tmpdir(), "rls-verify-seed-")), "seed.sql");
      writeFileSync(seed, `${seeded}\nINSERT INTO profiles (workos_user_id) VALUES ('user_a');\n`);
      const { code, output } = await run(["--disposable", "--seed", seed], databaseUrl);
      expect(output).toContain("applied 2 migrations");
      expect(output).toContain("(disposable)");
      expect(output).not.toContain("empty tables");
      expect(code).toBe(exitCodes.passed);
      expect(await scratchExists(databaseUrl, output)).toBe(false);
      // The URL's own database was never written.
      const { rows } = await sql(databaseUrl, "SELECT to_regclass('public.accounts') AS found");
      expect(rows[0].found).toBeNull();
    });
  }, 60_000);

  it("drops the scratch database when a migration fails", async () => {
    await withPostgres("db-tools-test", async (databaseUrl) => {
      const migrations = mkdtempSync(join(tmpdir(), "rls-verify-migrations-"));
      writeFileSync(join(migrations, "20260101000000_broken.sql"), "CREATE TABLE (;");
      const { code, output } = await run(["--disposable", "--migrations", migrations], databaseUrl);
      expect(output).toContain("20260101000000_broken.sql failed");
      expect(code).toBe(exitCodes.setup);
      expect(await scratchExists(databaseUrl, output)).toBe(false);
    });
  }, 60_000);
});
