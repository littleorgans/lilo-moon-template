import { createFileRoute } from "@tanstack/react-router";

import { requestCookies } from "../server/cookies.js";
import type { CookieJar } from "../server/cookies.js";
import { SESSION_COOKIE } from "../server/session.js";

/**
 * Drops the session cookie and returns to the sign-in page.
 *
 * It does not revoke the session at the provider. That is a real gap rather than an oversight:
 * revoking needs the session id from the token, and while sign-out is a GET it would also be
 * triggerable by any page that can make this browser fetch an image.
 */
export function signOut(_context: unknown, jar: CookieJar = requestCookies): Response {
  jar.clear(SESSION_COOKIE);
  return new Response(null, { status: 302, headers: { location: "/" } });
}

export const Route = createFileRoute("/api/auth/signout")({
  server: { handlers: { GET: signOut } },
});
