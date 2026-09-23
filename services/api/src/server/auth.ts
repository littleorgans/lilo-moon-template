import type { Verifier } from "@littleorgans/auth";
import { requireAuth } from "@littleorgans/auth-http/hono";
import type { AuthEnv } from "@littleorgans/auth-http/hono";
import type { MiddlewareHandler } from "hono";

import type { Log } from "./log.ts";
import { requestIdOf } from "./requests.ts";

export interface TenantAuthOptions {
  /** Built once per process with `createVerifier`: it caches the provider's keys. */
  readonly verify: Verifier;
  readonly log: Log;
}

/**
 * Bearer authentication for every tenant-scoped route.
 *
 * A token without an organization is refused with 403 `forbidden`: every row this service serves
 * belongs to one, and row level security matches an absent `org_id` against nothing, so the
 * request could only ever see an empty world or fail on a NOT NULL insert.
 *
 * Rejections are logged field by field, never as the event. The event holds the original request,
 * Authorization header included, so spreading it into a record would write the token to the log.
 * The path is the pathname alone because a query string can carry credentials too.
 */
export function tenantAuth({ verify, log }: TenantAuthOptions): MiddlewareHandler<AuthEnv> {
  return requireAuth({
    verify,
    authorize: (principal) => principal.orgId !== null,
    onRejection: ({ code, cause, request }) => {
      log({
        // An outage needs someone to look at it. A missing or expired token is ordinary traffic.
        level: code === "auth_unavailable" ? "error" : "info",
        event: "auth_rejected",
        requestId: requestIdOf(request),
        code,
        reason: cause?.reason ?? null,
        method: request.method,
        path: new URL(request.url).pathname,
      });
    },
  });
}
