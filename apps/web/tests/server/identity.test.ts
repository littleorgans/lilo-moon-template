import type { Principal } from "@littleorgans/auth";
import { describe, expect, it } from "vitest";

import { ensureIdentityRows } from "../../src/server/identity.js";
import { recordingTransaction } from "../database.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

describe("ensureIdentityRows", () => {
  it("inserts the caller's account and profile, leaving existing rows alone", async () => {
    const { tx, statements } = recordingTransaction();
    await ensureIdentityRows(tx, principal);
    expect(statements).toStrictEqual([
      {
        sql: 'insert into "accounts" ("id", "workos_org_id", "created_at") values (default, $1, default) on conflict ("workos_org_id") do nothing',
        params: ["org_01M0"],
      },
      {
        sql: 'insert into "profiles" ("id", "workos_user_id", "created_at") values (default, $1, default) on conflict ("workos_user_id") do nothing',
        params: ["user_01HBEQ"],
      },
    ]);
  });

  // A person who has not joined an organization yet has no tenant to create.
  it("creates only the profile when the caller has no organization", async () => {
    const { tx, statements } = recordingTransaction();
    await ensureIdentityRows(tx, { ...principal, orgId: null });
    expect(statements.map((statement) => statement.params)).toStrictEqual([["user_01HBEQ"]]);
    expect(statements[0]?.sql).toMatch(/^insert into "profiles"/);
  });
});
