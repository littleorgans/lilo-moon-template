import { createHash } from "node:crypto";

import { AuthError } from "@littleorgans/auth";
import type { Principal, Verifier } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth } from "@littleorgans/auth-workos";

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

export interface AccessDeps extends SessionCookieDeps {
  readonly verify: Verifier;
  /** Only `refreshTokens` is used. The whole client is taken so applications wire one object. */
  readonly auth: WorkOSAuth;
  readonly log: (failure: TokenFailure) => void;
}

function failureOf(error: unknown): TokenFailure {
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
 * WorkOS rotates the refresh token on every use. Parallel requests carrying one expired session,
 * such as loaders, server functions or a second tab, would each spend the same token. The first
 * rotates it, and a loser that WorkOS refuses with `invalid_grant` ends here as `ended`, clearing a
 * cookie the winner just wrote. So concurrent callers share the one provider call. Each still
 * verifies the result and writes the cookie itself, so every response carries the same new pair.
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

function ended(jar: CookieJar): Access {
  // A cookie that cannot be verified is not a session, so it does not survive the request that
  // discovered that. Leaving it would make every later request repeat this work and this log line.
  jar.clear(SESSION_COOKIE);
  return { status: "ended" };
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
 */
async function refreshed(jar: CookieJar, deps: AccessDeps, session: Session): Promise<Access> {
  let principal: Principal;
  let renewed;
  try {
    renewed = await sharedRefresh(deps.auth, session.refreshToken);
    principal = await deps.verify(renewed.accessToken);
  } catch (error) {
    const failure = failureOf(error);
    deps.log(failure);
    if (failure.status === "ended") return ended(jar);
    // A refresh may rotate before JWKS retrieval fails. Keep the replacement so a retry can use it.
    if (renewed !== undefined && failure.status === "unavailable") writeSession(jar, deps, renewed);
    return { status: failure.status };
  }

  writeSession(jar, deps, {
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken,
  });
  return { status: "signed-in", principal };
}

/**
 * Turns the session cookie into one of the five states a caller can act on.
 *
 * The access token is verified on every request. Nothing is trusted merely because it came out of
 * our own cookie: sealing proves we wrote it, and only the signature proves the provider issued
 * it. A cookie that survives a key rotation has to fail here.
 */
export async function readAccess(jar: CookieJar, deps: AccessDeps): Promise<Access> {
  const session = readSession(deps.cookieKey, jar.read(SESSION_COOKIE));
  if (session === null) return { status: "anonymous" };

  try {
    return { status: "signed-in", principal: await deps.verify(session.accessToken) };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.reason === "expired") return await refreshed(jar, deps, session);
    deps.log(failure);
    return failure.status === "ended" ? ended(jar) : { status: failure.status };
  }
}
