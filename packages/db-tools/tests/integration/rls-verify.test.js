// Plain JavaScript for the same reason as packages/db's integration test: it reuses the repo's one
// Postgres container helper from outside this project. It calls main() in-process so coverage sees
// the command line; root:published-shape runs the packed bin.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

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
  it("ignores a hostile search_path that can disable the read-only default", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE TABLE audit (n int);
        CREATE FUNCTION public.poison() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          IF current_setting('transaction_read_only') = 'off' THEN
            INSERT INTO public.audit VALUES (1);
          END IF;
          PERFORM set_config('default_transaction_read_only', 'off', false);
          RETURN false;
        END $$;
        CREATE VIEW public.pg_roles AS
          SELECT rolname, public.poison() OR rolsuper AS rolsuper, rolbypassrls
          FROM pg_catalog.pg_roles;`,
      );
      const url = new URL(databaseUrl);
      url.searchParams.set("options", "-c search_path=public,pg_catalog");
      const { code } = await run([], url.href);
      expect(code).toBe(exitCodes.failed); // audit itself is deliberately unprotected
      expect((await sql(databaseUrl, "SELECT count(*)::int AS n FROM audit")).rows[0].n).toBe(0);
    });
  }, 60_000);

  it("redacts a password raised by a policy, including a query-string password", async () => {
    await withMigrated(async (databaseUrl) => {
      const secret = "policy-secret/#";
      await sql(
        databaseUrl,
        `CREATE FUNCTION app.raises() RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'policy-secret/#'; END $$;
        CREATE POLICY raises ON accounts FOR SELECT USING (app.raises());`,
      );
      const url = new URL(databaseUrl);
      const role = `redaction_${process.pid}`;
      await sql(
        databaseUrl,
        `CREATE ROLE ${role} LOGIN PASSWORD '${secret}'; GRANT authenticated TO ${role}`,
      );
      url.username = role;
      url.searchParams.append("password", "discarded-password");
      url.searchParams.append("password", secret);
      try {
        const { code, output } = await run([], url.href);
        expect(code).toBe(exitCodes.failed);
        expect(output).toContain("***");
        expect(output).not.toContain(secret);
      } finally {
        await sql(databaseUrl, `DROP ROLE ${role}`);
      }
    });
  }, 60_000);

  it("verifies several quoted schemas and checks parents and direct partitions", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE SCHEMA "tenant space";
        CREATE TABLE "tenant space".events (id int) PARTITION BY RANGE (id);
        CREATE TABLE "tenant space".part PARTITION OF "tenant space".events FOR VALUES FROM (0) TO (10);
        INSERT INTO "tenant space".events VALUES (1);
        ALTER TABLE "tenant space".events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "tenant space".events FORCE ROW LEVEL SECURITY;
        ALTER TABLE "tenant space".part ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "tenant space".part FORCE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA "tenant space" TO authenticated;
        GRANT SELECT ON ALL TABLES IN SCHEMA "tenant space" TO authenticated;`,
      );
      const args = ["--schema", "public", "--schema", "tenant space"];
      expect((await run(args, databaseUrl)).code).toBe(exitCodes.passed);
      await sql(databaseUrl, 'ALTER TABLE "tenant space".events NO FORCE ROW LEVEL SECURITY');
      expect((await run(args, databaseUrl)).output).toContain('"tenant space".events (not forced)');
      await sql(
        databaseUrl,
        'ALTER TABLE "tenant space".events FORCE ROW LEVEL SECURITY; ALTER TABLE "tenant space".part NO FORCE ROW LEVEL SECURITY',
      );
      expect((await run(args, databaseUrl)).output).toContain('"tenant space".part (not forced)');
    });
  }, 60_000);

  it("uses disposable mode as a non-superuser with CREATEDB, CREATEROLE and the role grant", async () => {
    await withPostgres("db-tools-test", async (databaseUrl) => {
      applyMigrations(databaseUrl); // Provision the shared request role independently of test order.
      const role = `scratch_owner_${process.pid}`;
      await sql(
        databaseUrl,
        `CREATE ROLE ${role} LOGIN CREATEDB CREATEROLE PASSWORD 'scratch-owner'; GRANT authenticated TO ${role}`,
      );
      const url = new URL(databaseUrl);
      url.username = role;
      url.password = "scratch-owner";
      try {
        const { code, output } = await run(["--disposable"], url.href);
        expect(output).toContain("(disposable)");
        expect(code).toBe(exitCodes.passed);
        expect(await scratchExists(databaseUrl, output)).toBe(false);
      } finally {
        await sql(databaseUrl, `DROP ROLE ${role}`);
      }
    });
  }, 60_000);

  // Each attempt is one way a function could make the session writable. A later INSERT records
  // whether any worked; two runs catch a change that only takes effect in the next transaction.
  it("stays read-only whatever a policy function tries", async () => {
    await withMigrated(async (databaseUrl) => {
      const attempts = [
        "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE",
        "SELECT pg_catalog.set_config('default_transaction_read_only', 'off', false)",
        "SET TRANSACTION READ WRITE",
        "SELECT pg_catalog.set_config('transaction_read_only', 'off', true)",
        "COMMIT",
        "CREATE FUNCTION pg_temp.pg_has_role(name, oid, text) RETURNS boolean LANGUAGE sql AS 'SELECT true'",
      ];
      await sql(
        databaseUrl,
        `CREATE TABLE public.audit (what text);
         CREATE FUNCTION app.escape() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $f$
         DECLARE attempt text;
         BEGIN
           FOREACH attempt IN ARRAY ARRAY[${attempts.map((a) => `$q$${a}$q$`).join(", ")}] LOOP
             BEGIN EXECUTE attempt; EXCEPTION WHEN OTHERS THEN NULL; END;
           END LOOP;
           BEGIN INSERT INTO public.audit VALUES ('written'); EXCEPTION WHEN OTHERS THEN NULL; END;
           RETURN false;
         END $f$;
         GRANT EXECUTE ON FUNCTION app.escape() TO authenticated;
         CREATE POLICY escape ON accounts FOR SELECT USING (app.escape());`,
      );
      const first = await run([], databaseUrl);
      const second = await run([], databaseUrl);
      expect(first.output).toContain("absent claims reveal no rows");
      expect(second.output).toContain("absent claims reveal no rows");
      expect((await sql(databaseUrl, "SELECT count(*)::int AS n FROM audit")).rows[0].n).toBe(0);
    });
  }, 60_000);

  // Postgres 17 runs login event triggers when the session starts, before any transaction the tool
  // opens. The session is read-only from its startup parameters, so the trigger's write fails and
  // so does the connection, rather than the verification writing a row.
  it.each([[], ["--disposable"]])(
    "refuses to connect rather than let a login trigger write (%j)",
    async (...args) => {
      await withMigrated(async (databaseUrl) => {
        await sql(
          databaseUrl,
          `CREATE TABLE public.audit (what text);
         CREATE FUNCTION public.on_login() RETURNS event_trigger LANGUAGE plpgsql AS $f$
         BEGIN
           IF current_setting('application_name') = 'rls-verify' THEN
             INSERT INTO public.audit VALUES ('login');
           END IF;
         END $f$;
         CREATE EVENT TRIGGER audit_login ON login EXECUTE FUNCTION public.on_login();`,
        );
        // A -c in the URL cannot switch the startup read-only default back off.
        const url = new URL(databaseUrl);
        url.searchParams.set("options", "-c default_transaction_read_only=off");
        const { code, output } = await run(args, url.href);
        expect(output).toContain("read-only transaction");
        expect(code).toBe(exitCodes.setup);
        expect((await sql(databaseUrl, "SELECT count(*)::int AS n FROM audit")).rows[0].n).toBe(0);
      });
    },
    60_000,
  );

  // Policy functions resolve names with the application's search_path. Pinning the claim checks
  // to pg_catalog would fail this ordinary schema with "relation does not exist".
  it("runs policy functions with the session's search_path", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE TABLE members (org text);
         ALTER TABLE members ENABLE ROW LEVEL SECURITY;
         ALTER TABLE members FORCE ROW LEVEL SECURITY;
         INSERT INTO members VALUES ('org_a');
         CREATE FUNCTION public.is_member(org text) RETURNS boolean LANGUAGE sql STABLE
           SECURITY DEFINER AS 'SELECT org = nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''org_id'' AND EXISTS (SELECT 1 FROM members m WHERE m.org = is_member.org)';
         GRANT EXECUTE ON FUNCTION public.is_member(text) TO authenticated;
         CREATE POLICY via_members ON accounts FOR SELECT USING (public.is_member(workos_org_id));`,
      );
      const { code, output } = await run([], databaseUrl);
      expect(output).not.toContain("does not exist");
      expect(code).toBe(exitCodes.passed);
    });
  }, 60_000);

  // The claim checks keep the session's search_path, so a look-alike set_config ahead of pg_catalog
  // could skip the priming transaction and hide a policy that raises on empty claims.
  it("sets the claims through pg_catalog whatever the search_path", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE FUNCTION public.set_config(text, text, boolean) RETURNS text LANGUAGE sql
           AS 'SELECT NULL::text';
         GRANT EXECUTE ON FUNCTION public.set_config(text, text, boolean) TO PUBLIC;
         CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS text LANGUAGE sql STABLE
           SET search_path = pg_catalog
           AS $f$ SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'org_id' $f$;`,
      );
      const url = new URL(databaseUrl);
      url.searchParams.set("options", "-c search_path=public,pg_catalog");
      const { code, output } = await run([], url.href);
      expect(output).toContain("threw 22P02");
      expect(code).toBe(exitCodes.failed);
    });
  }, 60_000);

  // Look-alikes that would fail a sound database: pg_roles calling authenticated a superuser, and
  // to_regrole saying no role exists. The catalog reads pin search_path, so neither is consulted.
  it("reads the catalogs, not look-alikes on the search_path", async () => {
    await withMigrated(async (databaseUrl) => {
      await sql(
        databaseUrl,
        `CREATE VIEW public.pg_roles AS
           SELECT rolname, true AS rolsuper, rolbypassrls FROM pg_catalog.pg_roles;
         CREATE FUNCTION public.to_regrole(text) RETURNS regrole LANGUAGE sql
           AS 'SELECT NULL::regrole';`,
      );
      const url = new URL(databaseUrl);
      url.searchParams.set("options", "-c search_path=public,pg_catalog");
      const { code, output } = await run([], url.href);
      expect(output).toContain("ok    role authenticated cannot bypass row level security");
      expect(code).toBe(exitCodes.passed);
    });
  }, 60_000);
  it.each(["URL repetitions", "PGOPTIONS"])(
    "preserves pg's effective startup options from %s",
    async (source) => {
      await withMigrated(async (databaseUrl) => {
        await sql(
          databaseUrl,
          `CREATE POLICY startup_marker ON accounts FOR SELECT
        USING (pg_catalog.current_setting('rls_test.marker', true) IS DISTINCT FROM 'kept');`,
        );
        const url = new URL(databaseUrl);
        const options = "-c rls_test.marker=kept -c default_transaction_read_only=off";
        if (source === "URL repetitions") {
          url.searchParams.append("options", "-c rls_test.marker=discarded");
          url.searchParams.append("options", options);
        } else {
          vi.stubEnv("PGOPTIONS", options);
          // pg falls back to PGOPTIONS for an empty URL value too.
          url.searchParams.set("options", "");
        }
        try {
          const { code, output } = await run([], url.href);
          expect(output).toContain("4 checks passed");
          expect(code).toBe(exitCodes.passed);
        } finally {
          vi.unstubAllEnvs();
        }
      });
    },
    60_000,
  );

  it.each(["current_setting", "operator"])(
    "refuses writes from a policy's shadowed %s",
    async (shadow) => {
      await withMigrated(async (databaseUrl) => {
        await sql(
          databaseUrl,
          `CREATE SCHEMA effects; CREATE TABLE effects.audit (n int);
        CREATE FUNCTION public.shadow_setting(text, boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
        AS $$ BEGIN INSERT INTO effects.audit VALUES (1); RETURN NULL; END $$;
        CREATE FUNCTION public.shadow_equal(text, text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
        AS $$ BEGIN INSERT INTO effects.audit VALUES (1); RETURN false; END $$;
        ALTER FUNCTION public.shadow_setting(text, boolean) RENAME TO current_setting;
        CREATE OPERATOR public.= (FUNCTION=public.shadow_equal, LEFTARG=text, RIGHTARG=text);
        SET search_path=public,pg_catalog;
        CREATE FUNCTION public.policy_probe() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS
        $f$ SELECT ${shadow === "operator" ? "'left'::text = 'right'::text" : "current_setting('request.jwt.claims', true) IS NOT NULL"} $f$;
        CREATE POLICY shadowed ON accounts FOR SELECT USING (public.policy_probe());`,
        );
        const url = new URL(databaseUrl);
        url.searchParams.set("options", "-c search_path=public,pg_catalog");
        const { code, output } = await run([], url.href);
        expect(output).toContain("read-only transaction");
        expect(code).toBe(exitCodes.failed);
        expect(
          (await sql(databaseUrl, "SELECT pg_catalog.count(*)::int AS n FROM effects.audit"))
            .rows[0].n,
        ).toBe(0);
      });
    },
    60_000,
  );
});
