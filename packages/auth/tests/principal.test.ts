import { describe, expect, it } from "vitest";

import { AuthError } from "../src/errors.js";
import { toPrincipal } from "../src/principal.js";

const base = { sub: "user_01HBEQKA6K4QJAS93VPE39W1JT" };

describe("toPrincipal", () => {
  it("maps a full set of claims", () => {
    expect(
      toPrincipal({
        ...base,
        org_id: "org_01M0JSGEFHXQ7ZYWQJY5W9QJNN",
        roles: ["owner"],
        permissions: ["billing:manage"],
        entitlements: ["cubicell:pro"],
      }),
    ).toStrictEqual({
      userId: "user_01HBEQKA6K4QJAS93VPE39W1JT",
      orgId: "org_01M0JSGEFHXQ7ZYWQJY5W9QJNN",
      roles: ["owner"],
      permissions: ["billing:manage"],
      entitlements: ["cubicell:pro"],
    });
  });

  // A subject is text, not a uuid. Postgres helpers compare it as text for exactly this reason.
  it("keeps the subject as the opaque string the provider issued", () => {
    expect(toPrincipal(base).userId).toBe("user_01HBEQKA6K4QJAS93VPE39W1JT");
  });

  // A new social signup has no organization yet, which is a normal state and not an error.
  it("yields a null org for a user who belongs to no organization", () => {
    expect(toPrincipal(base).orgId).toBeNull();
  });

  it("defaults the three lists to empty when the claims are absent", () => {
    const principal = toPrincipal(base);
    expect(principal.roles).toStrictEqual([]);
    expect(principal.permissions).toStrictEqual([]);
    expect(principal.entitlements).toStrictEqual([]);
  });

  it("falls back to a singular role claim", () => {
    expect(toPrincipal({ ...base, role: "member" }).roles).toStrictEqual(["member"]);
  });

  it("prefers the plural roles claim when both are present", () => {
    expect(toPrincipal({ ...base, role: "member", roles: ["owner"] }).roles).toStrictEqual([
      "owner",
    ]);
  });

  it.each([
    ["sub", { sub: "" }],
    ["sub", {}],
    ["org_id", { ...base, org_id: 42 }],
    ["roles", { ...base, roles: [1, 2] }],
    ["permissions", { ...base, permissions: { manage: true } }],
    ["entitlements", { ...base, entitlements: [null] }],
  ])("rejects a %s claim of the wrong shape rather than reading it as empty", (_name, claims) => {
    expect(() => toPrincipal(claims)).toThrow(AuthError);
    try {
      toPrincipal(claims);
      expect.unreachable("toPrincipal should have rejected these claims");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      if (error instanceof AuthError) expect(error.reason).toBe("claims");
    }
  });
});
