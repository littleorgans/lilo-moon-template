import type { CookieJar } from "./cookies.js";
import { SESSION_COOKIE } from "./session.js";

/**
 * Drops the session cookie and returns to the sign-in page.
 *
 * It does not revoke the session at the provider. That is a real gap rather than an oversight:
 * revoking needs the session id from the token, and while sign-out is a GET it would also be
 * triggerable by any page that can make this browser fetch an image.
 */
export function signOut(_context: unknown, jar: CookieJar): Response {
  jar.clear(SESSION_COOKIE);
  return new Response(null, { status: 302, headers: { location: "/" } });
}
