import type { Principal, Verifier } from "@lilo-moon/auth";

import type { CookieJar } from "./cookies.js";
import { SESSION_COOKIE, readSession } from "./session.js";

export interface PrincipalDeps {
  readonly cookieKey: Buffer;
  readonly verify: Verifier;
}

/**
 * Turns the session cookie into a verified Principal, or null when there is no session.
 *
 * The access token is verified on every request. Nothing is trusted merely because it came out of
 * our own cookie: sealing proves we wrote it, and only the signature proves the provider issued it.
 * A cookie that survives a key rotation, or a token that has expired, has to fail here.
 *
 * A rejected token is not "no session": it raises. Returning null for both would let an expired
 * token and a forged one take the same quiet path, and the caller could no longer tell a person
 * who needs to sign in again from one whose token failed a check that matters.
 */
export async function readPrincipal(
  jar: CookieJar,
  deps: PrincipalDeps,
): Promise<Principal | null> {
  const session = readSession(deps.cookieKey, jar.read(SESSION_COOKIE));
  if (session === null) return null;
  return await deps.verify(session.accessToken);
}
