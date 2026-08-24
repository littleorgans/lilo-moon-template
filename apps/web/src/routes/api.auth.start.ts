import { createFileRoute } from "@tanstack/react-router";

import { requestCookies } from "../server/cookies.js";
import type { CookieJar } from "../server/cookies.js";
import { getServices } from "../server/services.js";
import { STATE_COOKIE, newState } from "../server/session.js";

/** Ten minutes is longer than anyone takes at a consent screen and short enough to be disposable. */
const STATE_MAX_AGE_SECONDS = 600;

export interface AuthorizeDeps {
  readonly authorizationUrl: (state: string) => string;
  readonly secureCookies: boolean;
}

function liveDeps(): AuthorizeDeps {
  const { auth, config } = getServices();
  return {
    authorizationUrl: (state) =>
      auth.getAuthorizationUrl({
        redirectUri: config.redirectUri,
        state,
        provider: "GoogleOAuth",
      }),
    secureCookies: config.secureCookies,
  };
}

/**
 * Starts a redirect sign-in.
 *
 * A server route rather than a link, because the `state` has to be minted and remembered before the
 * browser leaves. Remembering it means setting a cookie, which a plain anchor cannot do, and a
 * `state` nobody stored is a `state` nobody can check.
 *
 * The arguments are defaulted rather than read inside, so a test supplies a recording jar and this
 * never reaches for a request that is not there. The defaults are evaluated only when omitted.
 */
export function startAuthorization(
  _context: unknown,
  jar: CookieJar = requestCookies,
  deps: AuthorizeDeps = liveDeps(),
): Response {
  const state = newState();

  jar.write(STATE_COOKIE, state, {
    httpOnly: true,
    secure: deps.secureCookies,
    // Lax, not Strict. The callback is a top-level navigation arriving from the provider's origin,
    // and Strict withholds cookies on exactly that. Under Strict this cookie would be absent when
    // the callback reads it, so the check could never pass and sign-in would always fail.
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE_SECONDS,
  });

  return new Response(null, {
    status: 302,
    headers: { location: deps.authorizationUrl(state) },
  });
}

export const Route = createFileRoute("/api/auth/start")({
  server: { handlers: { GET: startAuthorization } },
});
