import type { Principal } from "@littleorgans/auth";

import { verified } from "./access.js";
import type { Access, AccessDeps } from "./access.js";
import type { CookieJar } from "./cookies.js";

/**
 * A `fetch` that calls a service as the signed-in person, with their access token as the bearer.
 *
 * Narrower than `fetch` on purpose. The URL must be absolute, because a relative one has no origin
 * to check, and a `Request` is not accepted, because its headers and URL would arrive already
 * decided. Rejects without sending anything when the URL's origin is not a configured service.
 */
export type UserFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * `Access`, with a way to call services in place of the token itself.
 *
 * The same five states, so a caller branches on it exactly as a loader branches on `Access`, and a
 * session that has ended or a provider that is down is never a thrown error. Only the signed-in state
 * can call anything.
 *
 * Deliberately not serialisable: `fetch` is a function, so returning this from a loader or a server
 * function fails loudly in the framework's serialiser instead of shipping anything to the browser.
 * The token lives only in that function's closure, which no serialiser or inspector can read.
 */
export type UserAccess =
  | { readonly status: "signed-in"; readonly principal: Principal; readonly fetch: UserFetch }
  | Exclude<Access, { readonly status: "signed-in" }>;

/**
 * A service reached over plain `http` on a network the application trusts, such as
 * `{ origin: "http://api:3000", insecure: true }` for a service inside the same cluster.
 *
 * The person's bearer token crosses that network readable by anything on the path, so there is no
 * switch that allows `http` everywhere. Each such origin is listed on its own, and `insecure: true`
 * is required, so the exception is written down next to the one address it covers.
 */
export interface InsecureServiceOrigin {
  readonly origin: string;
  readonly insecure: true;
}

/** An `https` origin (or `http` on localhost) as a string, or one opted-in plain `http` origin. */
export type ServiceOrigin = string | InsecureServiceOrigin;

export interface UserAccessDeps extends AccessDeps {
  /**
   * Every origin the token may be sent to, such as `https://api.example.com`. Anything else is
   * refused. An empty list refuses every call, which is the right default for an application that
   * calls no services.
   */
  readonly serviceOrigins: readonly ServiceOrigin[];
  /** Overridable so a test never needs a listening service. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The type already requires `true`. Read as unknown because JavaScript callers and parsed config
// need not honour it, and a truthy test would take the string "false" as consent.
function isTrue(flag: unknown): boolean {
  return flag === true;
}

/**
 * Checks one configured service origin, returning it in the form `URL.origin` compares against.
 *
 * HTTPS except on localhost, the rule `WORKOS_REDIRECT_URI` already follows: a bearer token over
 * plain http is readable by anything on the path. An `InsecureServiceOrigin` is the one exception,
 * and it must be `http`: on an `https` origin the flag would claim a risk that is not there. A
 * path, query or credentials are refused rather than dropped, because `https://api.example.com/v1`
 * reads as if it limited the token to `/v1`, and the origin is the only boundary this enforces.
 */
function serviceOrigin(entry: ServiceOrigin): string {
  const value = typeof entry === "string" ? entry : entry.origin;
  const url = new URL(value);
  if (typeof entry === "string") {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
      throw new Error(
        `Service origin ${value} must use HTTPS except on localhost. List a service on a network ` +
          `you trust as { origin: "${value}", insecure: true }.`,
      );
    }
  } else if (!isTrue(entry.insecure)) {
    throw new Error(`Service origin ${value} is an object without insecure: true.`);
  } else if (url.protocol !== "http:") {
    throw new Error(`Service origin ${value} is marked insecure but is not http.`);
  }
  // Anything beyond the origin, whether path, query, fragment or credentials, lengthens the href.
  if (url.href !== `${url.origin}/`) {
    throw new Error(`Service origin ${value} must be an origin only, such as ${url.origin}.`);
  }
  return url.origin;
}

function userFetch(accessToken: string, origins: ReadonlySet<string>, send: typeof fetch) {
  const fetchAsUser: UserFetch = async (url, init) => {
    // No base, so a relative URL throws here rather than resolving against something unintended.
    const target = new URL(url);
    // Checked before the origin, because a `blob:` URL reports the origin it was minted under, so
    // `blob:https://api.example.com/...` would pass the origin check with a scheme no service has.
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(
        `Refusing to send the access token to a ${target.protocol} URL: services are http or https.`,
      );
    }
    if (!origins.has(target.origin)) {
      throw new Error(
        `Refusing to send the access token to ${target.origin}: it is not in serviceOrigins.`,
      );
    }
    const headers = new Headers(init?.headers);
    // Set, not appended: a caller's own Authorization would otherwise travel alongside this one.
    headers.set("authorization", `Bearer ${accessToken}`);
    // A redirect to another origin drops the header, per the Fetch standard; same origin keeps it.
    return await send(target, { ...init, headers });
  };
  return fetchAsUser;
}

/**
 * Reads the session as `readAccess` does, and on success hands back a way to call services with it.
 *
 * The token is the one `readAccess` would have verified, so an expired one has already been
 * refreshed through the same shared call, and the renewed cookie written, before anything is sent.
 * It is fixed for this request: hold the result no longer than the request that produced it.
 *
 * The origins are checked before the session is read, so a misconfiguration surfaces on the first
 * call whether or not anyone is signed in.
 */
export async function readUserAccess(jar: CookieJar, deps: UserAccessDeps): Promise<UserAccess> {
  const origins = new Set(deps.serviceOrigins.map(serviceOrigin));
  const result = await verified(jar, deps);
  if (result.status !== "signed-in") return result;
  return {
    status: "signed-in",
    principal: result.principal,
    fetch: userFetch(result.accessToken, origins, deps.fetch ?? globalThis.fetch),
  };
}
