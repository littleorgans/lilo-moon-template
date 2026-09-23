import { decodeJwt } from "jose";

import type { CookieJar } from "./cookies.js";
import { refuseCrossOrigin } from "./origin.js";
import { EMAIL_COOKIE, SESSION_COOKIE, STATE_COOKIE, readSession } from "./session.js";
import type { CookieKeys } from "./session.js";

export interface SignOutDeps extends CookieKeys {
  readonly returnTo: string;
  readonly logoutUrl: (sessionId: string) => string;
}

/** The sealed cookie proves token provenance even when its access token has expired. */
export function signOut(
  { request }: { readonly request: Request },
  jar: CookieJar,
  deps: SignOutDeps,
): Response {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  const refused = refuseCrossOrigin(request, deps.returnTo);
  if (refused !== null) return refused;

  const session = readSession(deps, jar.read(SESSION_COOKIE));
  let location = deps.returnTo;
  if (session !== null) {
    try {
      const { sid } = decodeJwt(session.accessToken);
      if (typeof sid === "string" && sid.length > 0) location = deps.logoutUrl(sid);
    } catch {
      // A malformed token has no provider session to address. Always clear the local cookie.
    }
  }
  for (const name of [SESSION_COOKIE, STATE_COOKIE, EMAIL_COOKIE]) jar.clear(name);
  return new Response(null, { status: 303, headers: { location } });
}
