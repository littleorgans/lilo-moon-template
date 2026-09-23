import type { Verifier } from "@littleorgans/auth";
import type { AuthEnv } from "@littleorgans/auth-http/hono";
import { Hono } from "hono";

import type { ScopedRunner } from "../features/accounts/account.ts";
import { accountRoutes } from "../routes/account.ts";
import { healthRoutes } from "../routes/health.ts";
import { tenantAuth } from "./auth.ts";
import { handleError, notFound } from "./errors.ts";
import type { Log } from "./log.ts";
import { observeRequests } from "./requests.ts";

export interface AppDeps {
  readonly verify: Verifier;
  /** `database.withPrincipal` in production; a recording double in route tests. */
  readonly run: ScopedRunner;
  readonly log: Log;
}

/**
 * The whole HTTP surface, with no socket and no process state, so tests drive it through
 * `app.request()` exactly as `@hono/node-server` will.
 *
 * Authentication belongs to the `/v1` group rather than to each route. A route added under `/v1`
 * is authenticated because of where it is mounted, not because someone remembered to add it.
 */
export function createApp({ verify, run, log }: AppDeps) {
  const v1 = new Hono<AuthEnv>()
    .use(tenantAuth({ verify, log }))
    .use(async (c, next) => {
      await next();
      // Tenant data is never for a shared cache.
      c.header("cache-control", "no-store");
    })
    .route("/account", accountRoutes(run));

  return new Hono()
    .use(observeRequests(log))
    .route("/health", healthRoutes())
    .route("/v1", v1)
    .notFound(notFound)
    .onError(handleError(log));
}
