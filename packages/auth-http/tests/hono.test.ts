import type { Principal, Verifier } from "@littleorgans/auth";
import { AuthError } from "@littleorgans/auth";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { requireAuth } from "../src/hono.js";
import type { AuthEnv } from "../src/hono.js";

const principal: Principal = {
  userId: "user_01",
  orgId: null,
  roles: [],
  permissions: [],
  entitlements: [],
};

function appWith(verify: Verifier, authorize?: () => boolean) {
  const handler = vi.fn();
  const app = new Hono<AuthEnv>()
    .use(requireAuth(authorize === undefined ? { verify } : { verify, authorize }))
    .get("/me", (c) => {
      handler();
      return c.json(c.var.principal);
    });
  return { app, handler };
}

describe("requireAuth", () => {
  it("gives the handler the Principal", async () => {
    const { app } = appWith(async () => principal);
    const response = await app.request("/me", { headers: { authorization: "Bearer a.b.c" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(principal);
  });

  it("answers a rejection itself and never runs the handler", async () => {
    const { app, handler } = appWith(async () => {
      throw new AuthError("expired", "jwt expired at 12:00");
    });
    const response = await app.request("/me", { headers: { authorization: "Bearer a.b.c" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(await response.json()).toStrictEqual({ error: "expired_token" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 403 when the authorize hook refuses", async () => {
    const { app, handler } = appWith(
      async () => principal,
      () => false,
    );
    const response = await app.request("/me", { headers: { authorization: "Bearer a.b.c" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toStrictEqual({ error: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });
});
