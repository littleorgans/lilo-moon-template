// Plain JavaScript on purpose. This file reaches outside the package to reuse the one Postgres
// container helper the repo already owns, and importing across the project boundary from
// TypeScript would fight the composite build's rootDir for no benefit. The unit tests next door
// carry the types; this file exists to prove the pool glue against a real database.

import { describe, expect, it } from "vitest";

import {
  applyMigrations,
  dockerIsAvailable,
  withPostgres,
} from "../../../scripts/lib/postgres-container.mjs";
import { createDatabase } from "../src/index.js";

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
  it("seeds the caller's rows and scopes reads to them", async () => {
    await withPostgres(async (connectionString) => {
      applyMigrations(connectionString);
      const database = createDatabase({ connectionString });
      try {
        // A different tenant, inserted out of band, must stay invisible below.
        await database.withPrincipal(
          { ...principal, userId: "user_other", orgId: "org_other" },
          () => Promise.resolve(null),
        );

        const rows = await database.withPrincipal(principal, async (tx) => {
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
    await withPostgres(async (connectionString) => {
      applyMigrations(connectionString);
      const database = createDatabase({ connectionString, maxConnections: 1 });
      try {
        await expect(
          database.withPrincipal(principal, () => Promise.reject(new Error("body failed"))),
        ).rejects.toThrow("body failed");
        // With a pool of one, this only resolves if the failed transaction released its client.
        const rows = await database.withPrincipal(principal, async (tx) => {
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
