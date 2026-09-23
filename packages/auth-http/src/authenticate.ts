import { AuthError } from "@littleorgans/auth";
import type { AuthFailure, Principal, Verifier } from "@littleorgans/auth";

import { readBearerToken } from "./bearer.js";

/**
 * The error code a client sees in the response body. It is the whole public vocabulary of a
 * rejection: enough for a client to decide between sending a token, refreshing, giving up or
 * retrying later, and nothing about which check failed inside the verifier.
 */
export type RejectionCode =
  | "missing_token"
  | "malformed_token"
  | "expired_token"
  | "invalid_token"
  | "forbidden"
  | "auth_unavailable";

/** What the client is told. Only the code, so serialising a rejection can never leak more. */
export interface Rejection {
  readonly code: RejectionCode;
}

/**
 * What `onRejection` observes: the code, and what the client is not told. Server side only.
 */
export interface RejectionEvent {
  readonly code: RejectionCode;
  /** The verifier's error, when verification produced the rejection. */
  readonly cause?: AuthError;
  /** Original request, including credentials. Select safe fields; never log it wholesale. */
  readonly request: Request;
}

export type Authentication =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly rejection: Rejection };

export type Authenticator = (request: Request) => Promise<Authentication>;

export interface AuthenticatorOptions {
  readonly verify: Verifier;
  /**
   * Runs after a token verifies. Returning false answers 403: the caller is known and is not
   * allowed. Omit it when every authenticated caller may proceed.
   */
  readonly authorize?: (principal: Principal, request: Request) => boolean | Promise<boolean>;
  /**
   * Observes every rejection, including its cause, so a service can log why a request failed
   * without putting the reason in the response. A 503 in particular needs an alert, not a shrug.
   *
   * It is invoked synchronously, so keep its synchronous work short. Returned promises are not
   * awaited by authentication. An observer that throws or rejects produces a best-effort
   * `console.error` line naming the rejection code and the error's type, never its message;
   * failures in this fallback are ignored as well. Observer failures must not replace an auth
   * rejection with a 500.
   */
  readonly onRejection?: (event: RejectionEvent) => void | Promise<void>;
}

// Only `expired` gets its own code, because it is the one failure a client can fix by itself by
// refreshing. Signature, issuer, audience and claim failures collapse into one code: naming which
// check failed would tell a forger which part of a forgery to fix next.
const codeFor = {
  malformed: "malformed_token",
  expired: "expired_token",
  signature: "invalid_token",
  issuer: "invalid_token",
  audience: "invalid_token",
  claims: "invalid_token",
  unavailable: "auth_unavailable",
} as const satisfies Record<AuthFailure, RejectionCode>;

/**
 * The error-to-status table, and the only place a rejection becomes HTTP.
 *
 * Every 401 carries a `WWW-Authenticate: Bearer` challenge, which RFC 7235 requires. A request
 * with no bearer credential gets the bare challenge. A bad token also gets
 * `error="invalid_token"` (RFC 6750 section 3.1). A malformed Authorization header is a 401 rather
 * than RFC 6750's suggested 400, so a client's single "re-authenticate on 401" path covers it.
 *
 * `auth_unavailable` is a 503 without a challenge. The token may be perfectly good. Answering
 * 401 would tell a client to throw it away and sign the person out because our JWKS fetch failed.
 */
const responses = {
  missing_token: { status: 401, challenge: "Bearer" },
  malformed_token: { status: 401, challenge: 'Bearer error="invalid_token"' },
  expired_token: { status: 401, challenge: 'Bearer error="invalid_token"' },
  invalid_token: { status: 401, challenge: 'Bearer error="invalid_token"' },
  forbidden: { status: 403, challenge: null },
  auth_unavailable: { status: 503, challenge: null },
} as const satisfies Record<RejectionCode, { status: number; challenge: string | null }>;

/**
 * Renders a rejection as a JSON response: `{"error": "<code>"}` and nothing else. `no-store`
 * keeps a misconfigured shared cache from replaying a 401, or prolonging an outage's 503.
 */
export function rejectionResponse(rejection: Rejection): Response {
  const { status, challenge } = responses[rejection.code];
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (challenge !== null) headers.set("www-authenticate", challenge);
  return new Response(JSON.stringify({ error: rejection.code }), { status, headers });
}

// Identifier syntax is not redaction: opaque credentials and JWT fragments can be identifiers.
// Keep the diagnostic vocabulary finite. Custom error names/codes belong in application logging
// under its own redaction policy.
const observerErrorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
]);
// Node and libuv system codes, and the undici and stream codes a logger or log shipper raises
// when it fails. Each is a fixed identifier defined by the runtime, never derived from data.
const observerErrorCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "EADDRNOTAVAIL",
  "EACCES",
  "EPERM",
  "ENOENT",
  "EROFS",
  "ENOSPC",
  "EMFILE",
  "ENFILE",
  "EIO",
  "EBADF",
  "ABORT_ERR",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
  "ERR_INVALID_ARG_TYPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// Every property is read exactly once and checked without coercion: a getter can return a safe
// value for the check and a credential on its next read.
function listedCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const code: unknown = Reflect.get(value, "code");
  return typeof code === "string" && observerErrorCodes.has(code) ? code : null;
}

function observerFailure(code: RejectionCode, error: unknown): string {
  let label: string = typeof error;
  let errno: string | null = null;
  if (error instanceof Error) {
    const name: unknown = error.name;
    label = typeof name === "string" && observerErrorNames.has(name) ? name : "unlisted Error";
    // Built-in fetch rejects with a bare TypeError("fetch failed") and keeps the system code on
    // its cause. Without this a refused log shipper reads the same as a missing logger method.
    errno = listedCode(error) ?? listedCode(error.cause);
  } else {
    errno = listedCode(error);
  }
  const kind = errno === null ? label : `${label} ${errno}`;
  return `auth-http: onRejection failed while observing ${code} (${kind})`;
}

/**
 * Builds a function that turns a request into a Principal or a Rejection.
 *
 * Only an `AuthError` becomes a Rejection. Anything else the verifier or the authorize hook throws
 * is a bug or an outage in our own code, so it propagates for the framework to answer as a 500.
 * Reading it as a 401 would hide the bug behind a client error.
 */
export function createAuthenticator(options: AuthenticatorOptions): Authenticator {
  const { onRejection } = options;

  async function observe(event: RejectionEvent): Promise<void> {
    if (onRejection === undefined) return;
    // Snapshot our code before giving the observer an event it can mutate at runtime.
    const code = event.code;
    try {
      await onRejection(event);
    } catch (error) {
      // A replaced/broken console is another logging failure, not an unhandled rejection.
      try {
        console.error(observerFailure(code, error));
      } catch {
        // There is no further reporting path that cannot fail in turn.
      }
    }
  }

  function reject(request: Request, code: RejectionCode, cause?: AuthError): Authentication {
    // Deliberately not awaited: see `onRejection`. A synchronous observer still runs here, before
    // the response is returned.
    void observe(cause === undefined ? { code, request } : { code, cause, request });
    return { ok: false, rejection: { code } };
  }

  return async function authenticate(request: Request): Promise<Authentication> {
    const bearer = readBearerToken(request.headers);
    if (bearer.kind === "missing") return reject(request, "missing_token");
    if (bearer.kind === "malformed") return reject(request, "malformed_token");

    let principal: Principal;
    try {
      principal = await options.verify(bearer.token);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      return reject(request, codeFor[error.reason], error);
    }

    if (options.authorize !== undefined && !(await options.authorize(principal, request))) {
      return reject(request, "forbidden");
    }
    return { ok: true, principal };
  };
}
