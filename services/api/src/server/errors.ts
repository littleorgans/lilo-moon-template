import { DrizzleQueryError } from "drizzle-orm";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Log } from "./log.ts";
import { requestIdOf } from "./requests.ts";

/**
 * Error codes this service adds to auth-http's. Same body, `{"error": "<code>"}`, and the same
 * `no-store`, so a client parses every failure one way.
 */
export type ErrorCode = "not_found" | "unavailable" | "internal";

const statuses = {
  not_found: 404,
  unavailable: 503,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

export function errorResponse(code: ErrorCode): Response {
  return Response.json(
    { error: code },
    { status: statuses[code], headers: { "cache-control": "no-store" } },
  );
}

// Failures that say the database cannot be reached right now, not that the request or the code is
// wrong. A 503 tells the client to retry later, as auth-http's `auth_unavailable` does. Anything
// else, a missing grant (42501) included, is a deployment or code bug and stays a 500.
const unreachable = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  // SQLSTATE: the server is shutting down, crashed, starting, or out of connection slots.
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);

function codeOf(error: unknown): string | null {
  // A failed query reaches here as Drizzle's wrapper, with the driver's error, and its code, as the
  // cause. A failure to connect comes from the pool before any query, unwrapped.
  const failure = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof failure !== "object" || failure === null || !("code" in failure)) return null;
  // Only fixed-format codes are logged: errno names and five-character SQLSTATEs.
  return typeof failure.code === "string" && /^(?:E[A-Z_]+|[0-9A-Z]{5})$/.test(failure.code)
    ? failure.code
    : null;
}

/** Whether an error means "try again later". SQLSTATE class 08 is every connection exception. */
export function isUnavailable(error: unknown): boolean {
  const code = codeOf(error);
  return code !== null && (unreachable.has(code) || /^08[0-9A-Z]{3}$/.test(code));
}

/**
 * Turns an unexpected error into a status and a generic body.
 *
 * The log records the error's code and nothing it could have copied from a request or a row: a
 * Postgres message can quote the value that violated a constraint, and a stack can quote a query.
 * Hono's own `HTTPException`s, such as a body limit, keep the response they were built with.
 */
export function handleError(log: Log): ErrorHandler {
  return (error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const code = isUnavailable(error) ? "unavailable" : "internal";
    log({
      level: "error",
      event: "request_failed",
      requestId: requestIdOf(c.req.raw),
      code,
      cause: codeOf(error),
    });
    return errorResponse(code);
  };
}

export const notFound: NotFoundHandler = () => errorResponse("not_found");
