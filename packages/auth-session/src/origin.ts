/**
 * Refuses a state-changing request that a page on another origin made the browser send.
 *
 * Returns the 403 to answer with, or null when the request may proceed. `appUrl` is any URL on the
 * application's own origin, normally the configured redirect URI, never the request's own URL:
 * behind a proxy that terminates TLS the request can arrive as `http:` while the browser, and its
 * Origin header, say `https:`.
 *
 * Exact equality, and a missing Origin is refused like a wrong one. Every browser this application
 * supports sends Origin on a POST, same-origin included, so a request without one did not come
 * from a page this application served. Falling back to `Sec-Fetch-Site` or `Referer` would only
 * add ways in: a browser that sends either also sends Origin. The one legitimate page this refuses
 * is one served with `Referrer-Policy: no-referrer`, which makes the browser send `Origin: null`;
 * this application sets no such policy. Clients that are not browsers can forge the header, which
 * is why this is cross-site request forgery protection and not authentication.
 */
export function refuseCrossOrigin(request: Request, appUrl: string): Response | null {
  if (request.headers.get("origin") === new URL(appUrl).origin) return null;
  return new Response("This request did not come from this application.", { status: 403 });
}
