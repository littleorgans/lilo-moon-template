// Plain JavaScript on purpose. This file reaches outside the package for the Postgres container
// helper in @littleorgans/db-tools's source, and importing across the project boundary from
// TypeScript would fight the composite build's rootDir for no benefit. A path, not the package:
// db-tools already depends on db for its migrations, and a dependency back would be a cycle. The
// unit tests next door carry the types; this file exists to prove the pool glue against a real
// database.

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { applyMigrations } from "../../../db-tools/src/atlas.ts";
import { dockerIsAvailable, withPostgres } from "../../../db-tools/src/postgres.ts";
import { createDatabase } from "../../src/index.js";

const migrations = fileURLToPath(new URL("../../migrations", import.meta.url));

const principal = {
  userId: "user_integration",
  orgId: "org_integration",
  roles: [],
  permissions: [],
  entitlements: [],
};

// Skipped without Docker, like root:drizzle-check and root:rls-verify. CI is authoritative.
describe("createDatabase configuration", () => {
  it("refuses a role that is not a plain identifier, before opening anything", () => {
    // Deterministic on purpose. An earlier version of this test allowed ECONNREFUSED as a pass,
    // which meant it never reached the check it claimed to cover.
    expect(() =>
      createDatabase({
        connectionString: "postgres://127.0.0.1:1/none",
        role: "authenticated; DROP TABLE accounts",
      }),
    ).toThrow("not a plain identifier");
  });
});

describe.skipIf(!dockerIsAvailable())("createDatabase", () => {
  it("scopes caller-owned inserts and reads", async () => {
    await withPostgres("db-test", async (connectionString) => {
      applyMigrations(connectionString, migrations);
      const database = createDatabase({ connectionString });
      try {
        // A different tenant, inserted out of band, must stay invisible below.
        await database.withPrincipal(
          { ...principal, userId: "user_other", orgId: "org_other" },
          async (tx) => {
            await tx.execute("INSERT INTO accounts (workos_org_id) VALUES ('org_other')");
          },
        );

        const rows = await database.withPrincipal(principal, async (tx) => {
          await tx.execute("INSERT INTO accounts (workos_org_id) VALUES ('org_integration')");
          const result = await tx.execute("SELECT workos_org_id FROM accounts");
          return result.rows;
        });
        expect(rows).toStrictEqual([{ workos_org_id: "org_integration" }]);
      } finally {
        await database.close();
      }
    });
  }, 60_000);

  it("returns the connection to the pool after a failed transaction", async () => {
    await withPostgres("db-test", async (connectionString) => {
      applyMigrations(connectionString, migrations);
      const database = createDatabase({ connectionString, maxConnections: 1 });
      try {
        await expect(
          database.withPrincipal(principal, () => Promise.reject(new Error("body failed"))),
        ).rejects.toThrow("body failed");
        // With a pool of one, this only resolves if the failed transaction released its client.
        const rows = await database.withPrincipal(principal, async (tx) => {
          await tx.execute("INSERT INTO profiles (workos_user_id) VALUES ('user_integration')");
          const result = await tx.execute("SELECT workos_user_id FROM profiles");
          return result.rows;
        });
        expect(rows).toStrictEqual([{ workos_user_id: "user_integration" }]);
      } finally {
        await database.close();
      }
    });
  }, 60_000);
});
