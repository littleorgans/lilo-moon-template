import type { AuthEnv } from "@littleorgans/auth-http/hono";
import { Hono } from "hono";

import { findAccount, provisionAccount } from "../features/accounts/account.ts";
import type { ScopedRunner } from "../features/accounts/account.ts";

/** `/v1/account`: the signed-in caller's organization account. Mounted behind `tenantAuth`. */
export function accountRoutes(run: ScopedRunner) {
  return new Hono<AuthEnv>()
    .get("/", async (c) => {
      const account = await run(c.var.principal, findAccount);
      return account === null ? c.json({ error: "account_not_found" }, 404) : c.json(account);
    })
    .put("/", async (c) => {
      const { account, created } = await run(c.var.principal, provisionAccount);
      return c.json(account, created ? 201 : 200);
    });
}
