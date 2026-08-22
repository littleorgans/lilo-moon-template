import type { Principal } from "@lilo-moon/auth";
import { describe, expect, it } from "vitest";

import type { ScopedClient } from "../src/index.js";
import { assertRoleName, claimsJson, runScoped } from "../src/index.js";

interface Statement {
  readonly text: string;
  readonly values?: readonly unknown[];
}

function recorder(failOn?: RegExp): { client: ScopedClient; statements: Statement[] } {
  const statements: Statement[] = [];
  return {
    statements,
    client: {
      async query(text: string, values?: readonly unknown[]) {
        statements.push(values === undefined ? { text } : { text, values });
        if (failOn?.test(text)) throw new Error(`database rejected: ${text}`);
        return await Promise.resolve({});
      },
    },
  };
}

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: ["cubicell:pro"],
};

const texts = (statements: readonly Statement[]) => statements.map((statement) => statement.text);

describe("runScoped", () => {
  it("opens a transaction, scopes it, seeds the rows, then commits, in that order", async () => {
    const { client, statements } = recorder();
    await runScoped(client, principal, "authenticated", () => Promise.resolve("done"));
    expect(texts(statements)).toStrictEqual([
      "BEGIN",
      "SET LOCAL ROLE authenticated",
      "SELECT set_config('request.jwt.claims', $1, true)",
      "INSERT INTO accounts (workos_org_id) VALUES ($1) ON CONFLICT (workos_org_id) DO NOTHING",
      "INSERT INTO profiles (workos_user_id) VALUES ($1) ON CONFLICT (workos_user_id) DO NOTHING",
      "COMMIT",
    ]);
  });

  // Ordering is the whole point. Claims set before BEGIN would be session-wide, and claims set
  // after the caller's queries would leave those queries unscoped.
  it("sets the role and the claims before anything reads a row", async () => {
    const { client, statements } = recorder();
    await runScoped(client, principal, "authenticated", async () => {
      await client.query("SELECT * FROM accounts");
      return null;
    });
    const order = texts(statements);
    expect(order.indexOf("SELECT * FROM accounts")).toBeGreaterThan(
      order.indexOf("SELECT set_config('request.jwt.claims', $1, true)"),
    );
    expect(order.indexOf("SELECT set_config('request.jwt.claims', $1, true)")).toBeGreaterThan(
      order.indexOf("BEGIN"),
    );
  });

  it("passes the verified claims, not the raw token", async () => {
    const { client, statements } = recorder();
    await runScoped(client, principal, "authenticated", () => Promise.resolve(null));
    const setClaims = statements.find((statement) => statement.text.includes("set_config"));
    expect(JSON.parse(String(setClaims?.values?.[0]))).toStrictEqual({
      sub: "user_01HBEQ",
      org_id: "org_01M0",
      roles: ["owner"],
      permissions: ["billing:manage"],
      entitlements: ["cubicell:pro"],
    });
  });

  // First sign-in through a social provider arrives with no organization. That is a normal state,
  // so there is simply no tenant row to create yet.
  it("creates no account row for a principal with no organization", async () => {
    const { client, statements } = recorder();
    await runScoped(client, { ...principal, orgId: null }, "authenticated", () =>
      Promise.resolve(null),
    );
    expect(texts(statements).some((text) => text.includes("INTO accounts"))).toBe(false);
    expect(texts(statements).some((text) => text.includes("INTO profiles"))).toBe(true);
  });

  it("rolls back and rethrows when the body fails", async () => {
    const { client, statements } = recorder();
    const failure = new Error("the caller's query failed");
    await expect(
      runScoped(client, principal, "authenticated", () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(texts(statements)).toContain("ROLLBACK");
    expect(texts(statements)).not.toContain("COMMIT");
  });

  it("rolls back when seeding itself fails", async () => {
    const { client, statements } = recorder(/INTO accounts/u);
    await expect(
      runScoped(client, principal, "authenticated", () => Promise.resolve(null)),
    ).rejects.toThrow("database rejected");
    expect(texts(statements)).toContain("ROLLBACK");
  });

  // If ROLLBACK throws too, the caller must still see what actually went wrong.
  it("reports the original failure even when the rollback also fails", async () => {
    const { client } = recorder(/INTO profiles|ROLLBACK/u);
    await expect(
      runScoped(client, principal, "authenticated", () => Promise.resolve(null)),
    ).rejects.toThrow("INSERT INTO profiles");
  });
});

describe("runScoped role handling", () => {
  // Directly catches removing the validation call from runScoped. Without this, deleting it is
  // invisible: assertRoleName stays green on its own while nothing calls it.
  it("rejects a bad role before issuing a single statement", async () => {
    const { client, statements } = recorder();
    await expect(
      runScoped(client, principal, "authenticated; DROP TABLE accounts", () =>
        Promise.resolve(null),
      ),
    ).rejects.toThrow("not a plain identifier");
    expect(statements).toStrictEqual([]);
  });
});

describe("assertRoleName", () => {
  it("accepts a plain identifier", () => {
    expect(assertRoleName("authenticated")).toBe("authenticated");
  });

  // SET ROLE cannot take a bind parameter, so the identifier is interpolated. This is the guard.
  it.each([
    ["authenticated; DROP TABLE accounts"],
    ["public--"],
    [""],
    ["1role"],
    ['"quoted"'],
    ["role name"],
  ])("refuses %o rather than interpolating it", (role) => {
    expect(() => assertRoleName(role)).toThrow("not a plain identifier");
  });
});

describe("claimsJson", () => {
  it("keeps a null organization null rather than dropping the key", () => {
    expect(JSON.parse(claimsJson({ ...principal, orgId: null }))).toMatchObject({ org_id: null });
  });
});
