import { randomUUID } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import type { Log } from "./log.ts";

// Keyed by the request object itself, because auth-http's onRejection receives the `Request` and
// nothing else. The id is generated here rather than read from an incoming header, so a client
// cannot choose what lands in the log.
const ids = new WeakMap<Request, string>();

/** The id `observeRequests` gave this request, for correlating log lines with it. */
export function requestIdOf(request: Request): string | null {
  return ids.get(request) ?? null;
}

/**
 * Gives each request an id, returns it as `x-request-id`, and writes one access log line when the
 * response is ready. Registered first, so it also sees responses from the error handler.
 */
export function observeRequests(log: Log): MiddlewareHandler {
  return async (c, next) => {
    const requestId = randomUUID();
    ids.set(c.req.raw, requestId);
    const started = performance.now();
    await next();
    c.header("x-request-id", requestId);
    log({
      level: "info",
      event: "request",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  };
}
