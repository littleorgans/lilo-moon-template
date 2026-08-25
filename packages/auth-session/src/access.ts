import { AuthError } from "@lilo-moon/auth";
import type { Principal, Verifier } from "@lilo-moon/auth";
import type { WorkOSAuth } from "@lilo-moon/auth-workos";

import type { CookieJar } from "./cookies.js";
import type { TokenFailure } from "./failure.js";
import { SESSION_COOKIE, readSession, writeSession } from "./session.js";
import type { Session, SessionCookieDeps } from "./session.js";

/**
 * Who is calling, as one value covering every state a session cookie can be in.
 *
 * A union rather than a Principal-or-throw, because all four outcomes are ordinary things that
 * happen to a running application and three of them decide what the person sees. An exception
 * would leave that decision to whatever catches it, which in a framework is a serialised stack
 * trace: the same failure mode the sign-in callback was already fixed for.
 */
export type Access =
  | { readonly status: "anonymous" }
  | { readonly status: "signed-in"; readonly principal: Principal }
  /** The token failed a check that may mean anything from key rotation to an attack. */
  | { readonly status: "ended" }
  /** Signature good, shape wrong. Our outage, so never a sign-in button. */
  | { readonly status: "broken" };

export interface AccessDeps extends SessionCookieDeps {
  readonly verify: Verifier;
  /** Only `refreshTokens` is used. The whole client is taken so applications wire one object. */
  readonly auth: WorkOSAuth;
  readonly log: (failure: TokenFailure) => void;
}

function failureOf(error: unknown): TokenFailure {
  const reason = error instanceof AuthError ? error.reason : "malformed";
  // `claims` is the only reason that is ours rather than theirs, and the only one that must not
  // send somebody to a sign-in button they would press forever.
  return { kind: "token", reason, status: reason === "claims" ? "broken" : "ended", error };
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
 */
async function refreshed(jar: CookieJar, deps: AccessDeps, session: Session): Promise<Access> {
  let principal: Principal;
  let renewed;
  try {
    renewed = await deps.auth.refreshTokens({ refreshToken: session.refreshToken });
    principal = await deps.verify(renewed.accessToken);
  } catch (error) {
    // Both throws mean the same thing to the person holding the browser: this session is over. A
    // refresh token is revoked or expired, or the token it bought does not verify.
    const failure = failureOf(error);
    deps.log(failure);
    return failure.status === "broken" ? { status: "broken" } : ended(jar);
  }

  writeSession(jar, deps, {
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken,
  });
  return { status: "signed-in", principal };
}

/**
 * Turns the session cookie into one of the four states a caller can act on.
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
    return failure.status === "broken" ? { status: "broken" } : ended(jar);
  }
}
