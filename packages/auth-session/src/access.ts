import { createHash } from "node:crypto";

import { AuthError } from "@littleorgans/auth";
import type { Principal, Verifier } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth } from "@littleorgans/auth-workos";
import { decodeJwt } from "jose";

import type { CookieJar } from "./cookies.js";
import type { TokenFailure } from "./failure.js";
import { SESSION_COOKIE, readSession, writeSession } from "./session.js";
import type { Session, SessionCookieDeps } from "./session.js";

/**
 * Who is calling, as one value covering every state a session cookie can be in.
 *
 * A union rather than a Principal-or-throw, because all five outcomes are ordinary things that
 * happen to a running application and each determines what the person sees. An exception
 * would leave that decision to whatever catches it, which in a framework is a serialised stack
 * trace: the same failure mode the sign-in callback was already fixed for.
 */
export type Access =
  | { readonly status: "anonymous" }
  | { readonly status: "signed-in"; readonly principal: Principal }
  /** The token failed a check that may mean anything from key rotation to an attack. */
  | { readonly status: "ended" }
  /** Signature good, shape wrong. Our outage, so never a sign-in button. */
  | { readonly status: "broken" }
  | { readonly status: "unavailable" };

/**
 * `Access` with the token the signed-in state was proven with. Internal to this package.
 *
 * Only `readAccess` and `readUserAccess` see it, and each rebuilds its own value from it rather than
 * passing it on, so the token never becomes a property of anything an application holds.
 */
export type Verified =
  | { readonly status: "signed-in"; readonly principal: Principal; readonly accessToken: string }
  | Exclude<Access, { readonly status: "signed-in" }>;

export interface AccessDeps extends SessionCookieDeps {
  readonly verify: Verifier;
  /** Only `refreshTokens` is used. The whole client is taken so applications wire one object. */
  readonly auth: WorkOSAuth;
  readonly log: (failure: TokenFailure) => void;
}

/** A failure as classified, before an early refresh can report it as `signed-in`. */
type Failure = TokenFailure & { readonly status: Exclude<TokenFailure["status"], "signed-in"> };

function failureOf(error: unknown): Failure {
  const reason =
    error instanceof AuthError || error instanceof WorkOSAuthError ? error.reason : "unavailable";
  const status =
    reason === "unavailable" || reason === "rate-limited"
      ? "unavailable"
      : reason === "claims" || reason === "configuration" || reason === "provider"
        ? "broken"
        : "ended";
  return { kind: "token", reason, status, error };
}

/**
 * The refreshes this process is waiting on, keyed by a digest of the refresh token spent.
 *
 * WorkOS rotates the refresh token on every use. Parallel requests carrying one session that has
 * expired, or is within `REFRESH_MARGIN_SECONDS` of it, such as loaders, server functions or a
 * second tab, would each spend the same token. The first rotates it, and a loser that WorkOS
 * refuses with `invalid_grant` ends here as `ended`, clearing a cookie the winner just wrote. So
 * concurrent callers share the one provider call. Each still verifies the result and writes the
 * cookie itself, so every response carries the same new pair.
 *
 * A digest rather than the token, so no raw credential is a key in long-lived memory. An entry
 * lives only while its call is in flight: it is removed when the call settles, success or failure,
 * and nothing is remembered afterwards. A request that arrives just after, still carrying the old
 * cookie, relies on WorkOS returning the same rotated pair for 30 seconds after first use.
 *
 * This is one process. Instances do not share it, and there is no cross-instance lock: a
 * deployment with more than one instance relies on that same 30-second window.
 */
const inFlight = new Map<string, Promise<Authentication>>();

/** How many refreshes are in flight. For tests, which prove that none outlives its call. */
export function refreshesInFlight(): number {
  return inFlight.size;
}

async function refreshOnce(
  auth: WorkOSAuth,
  refreshToken: string,
  key: string,
): Promise<Authentication> {
  try {
    // Yield before calling, so the caller has stored this promise before the removal below can
    // run. A client that threw synchronously would otherwise remove the entry before it existed,
    // and the entry stored after it would never be removed.
    await Promise.resolve();
    return await auth.refreshTokens({ refreshToken });
  } finally {
    inFlight.delete(key);
  }
}

function sharedRefresh(auth: WorkOSAuth, refreshToken: string): Promise<Authentication> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  let pending = inFlight.get(key);
  if (pending === undefined) {
    pending = refreshOnce(auth, refreshToken, key);
    inFlight.set(key, pending);
  }
  return pending;
}

function ended(jar: CookieJar): Verified {
  // A cookie that cannot be verified is not a session, so it does not survive the request that
  // discovered that. Leaving it would make every later request repeat this work and this log line.
  jar.clear(SESSION_COOKIE);
  return { status: "ended" };
}

/** The token `verified` has already proven, for `refreshed` to fall back on. */
interface Proven {
  readonly principal: Principal;
  readonly accessToken: string;
}

/**
 * Verifies the access token, buying a new one when the only thing wrong with it is its age.
 *
 * An access token lives 300 seconds, measured against the live provider, so expiry is the common
 * case rather than an error: a person reading a page for six minutes hits it. The refresh happens
 * here, once, and the replacement is verified like any other token rather than trusted for having
 * arrived over TLS. Refreshing without an `organizationId` preserves the one already in the token,
 * also measured rather than assumed, so a silent refresh cannot quietly drop somebody's tenant.
 * Concurrent requests for one session share the provider call; see `inFlight`.
 *
 * `current` is the token when it still verifies and the refresh started early, within
 * `REFRESH_MARGIN_SECONDS` of its expiry. Then no failure of the refresh changes the session: the
 * person is served `current`, the failure is logged as `signed-in`, and the cookie is left as it
 * was, apart from a rotated replacement whose verification was unavailable, which is kept as it is
 * on the expired path. A provider outage does not become an outage while the token has seconds
 * left. Nor does `invalid_grant` end the session, because inside the margin it is also what a
 * request still carrying the old cookie gets once WorkOS's reuse window has passed, and ending it
 * there would clear the newer cookie the winner wrote. A revoked session still ends, at expiry,
 * which is when it ended before the margin existed: `current` verifies for at most the margin plus
 * the clock tolerance, so nothing here outlives what the verifier already allowed.
 *
 * Nothing remembers the failure, so each request inside the margin tries again. A memory of it,
 * keyed by the same digest, would need a lifetime of its own and break the rule in `inFlight` that
 * no entry outlives its call, to save at most the margin plus the tolerance of failing calls per
 * session: once the token expires, the expired path makes the same call for every request and
 * returns `unavailable`. Concurrent callers in that time already share one call.
 */
async function refreshed(
  jar: CookieJar,
  deps: AccessDeps,
  session: Session,
  current?: Proven,
): Promise<Verified> {
  let principal: Principal;
  let renewed;
  try {
    renewed = await sharedRefresh(deps.auth, session.refreshToken);
    principal = await deps.verify(renewed.accessToken);
  } catch (error) {
    const failure = failureOf(error);
    // A refresh may rotate before JWKS retrieval fails. Keep the replacement so a retry can use it.
    if (renewed !== undefined && failure.status === "unavailable") writeSession(jar, deps, renewed);
    if (current !== undefined) {
      deps.log({ ...failure, status: "signed-in" });
      return { status: "signed-in", ...current };
    }
    deps.log(failure);
    return failure.status === "ended" ? ended(jar) : { status: failure.status };
  }

  writeSession(jar, deps, {
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken,
  });
  return { status: "signed-in", principal, accessToken: renewed.accessToken };
}

/**
 * How close to its expiry a token that still verifies is refreshed anyway.
 *
 * `readUserAccess` forwards the token to services, and one with seconds left expires in flight or
 * at the service, which answers 401. Twenty seconds covers a request's service calls with room to
 * spare, and costs one refresh per 280 seconds of use instead of per 300.
 *
 * It must stay below WorkOS's 30-second reuse window, less the verifier's clock tolerance (5 seconds
 * by default). The refresh spends the refresh token while the old access token still verifies, for
 * up to this margin plus that tolerance, and every request still carrying the old cookie in that
 * time, on this instance or another, refreshes with the spent token again. The first use is never
 * earlier than this margin before `exp`, so the window reaches at least 30 minus this margin past
 * `exp`, and the old token stops verifying 5 seconds past it. Inside the window WorkOS answers with
 * the same new pair, so each of those responses carries it too. Past it WorkOS refuses, and
 * `refreshed` serves the old token rather than ending the session, but the call is wasted and that
 * response carries no new pair. Twenty leaves 5 seconds of the window for a slow first call.
 *
 * The comparison uses this process's clock, as the verifier's expiry check does. A clock more than
 * 300 minus this margin seconds ahead of the provider's puts every fresh token inside the margin
 * and refreshes on every request; 25 seconds more and the verifier rejects every token as expired,
 * which it always did. There is no guard, because `iat` and `exp` are both the provider's and give
 * no way to tell skew from age. The remedy is the clock.
 */
export const REFRESH_MARGIN_SECONDS = 20;

/**
 * Seconds until the token expires, or null when it has no numeric `exp` to read.
 *
 * Only ever called on a token that has already verified, so the claim is one the provider signed.
 * `createVerifier` requires `exp`, so null means a verifier of the application's own that accepts
 * tokens without one. Its verdict stands and the token is served: there is no expiry to be near.
 */
function secondsLeft(token: string): number | null {
  let exp: unknown;
  try {
    ({ exp } = decodeJwt(token));
  } catch {
    return null;
  }
  return typeof exp === "number" ? exp - Date.now() / 1000 : null;
}

/**
 * Turns the session cookie into one of the five states, keeping the token that proved the first.
 *
 * The access token is verified on every request. Nothing is trusted merely because it came out of
 * our own cookie: sealing proves we wrote it, and only the signature proves the provider issued
 * it. A cookie that survives a key rotation has to fail here.
 *
 * A token that verifies but expires within `REFRESH_MARGIN_SECONDS` is refreshed as if it had
 * expired. If that refresh fails, the person is still signed in with the token they came with; see
 * `refreshed`.
 */
export async function verified(jar: CookieJar, deps: AccessDeps): Promise<Verified> {
  const session = readSession(deps.cookieKey, jar.read(SESSION_COOKIE));
  if (session === null) return { status: "anonymous" };

  let principal: Principal;
  try {
    principal = await deps.verify(session.accessToken);
  } catch (error) {
    const failure = failureOf(error);
    if (failure.reason === "expired") return await refreshed(jar, deps, session);
    deps.log(failure);
    return failure.status === "ended" ? ended(jar) : { status: failure.status };
  }

  // Read only now: before the signature is checked, `exp` is whatever the cookie's holder wrote.
  const left = secondsLeft(session.accessToken);
  if (left !== null && left <= REFRESH_MARGIN_SECONDS) {
    return await refreshed(jar, deps, session, { principal, accessToken: session.accessToken });
  }
  return { status: "signed-in", principal, accessToken: session.accessToken };
}

/**
 * Turns the session cookie into one of the five states a caller can act on.
 *
 * A token near its expiry is refreshed first, and a failure of that early refresh leaves the
 * person signed in on the token they came with, as `verified` describes.
 */
export async function readAccess(jar: CookieJar, deps: AccessDeps): Promise<Access> {
  const result = await verified(jar, deps);
  // Rebuilt rather than returned: `Access` is what loaders hand the page, and the token must not
  // ride along in a value that gets serialised to the browser.
  return result.status === "signed-in"
    ? { status: "signed-in", principal: result.principal }
    : result;
}
