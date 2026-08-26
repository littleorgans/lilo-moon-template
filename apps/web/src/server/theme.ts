import {
  THEME_COOKIE,
  cookieValue,
  nextPreference,
  parseThemePreference,
  serializeThemePreference,
} from "@lilo-moon/theme";

/**
 * Where the redirect goes after the cookie is set: back to the page the form was on, so the
 * switcher works from anywhere. The referer only steers the redirect when it parses to this
 * origin, because a redirect target from a request header is otherwise an open redirect.
 */
function returnPath(request: Request): string {
  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      const target = new URL(referer);
      if (target.origin === new URL(request.url).origin) return target.pathname + target.search;
    } catch {
      // Not a URL; fall through to the fixed destination.
    }
  }
  return "/theme";
}

/**
 * The switcher's whole server side: read the current preference from the cookie, apply the one
 * submitted field, write the cookie back, bounce. Built on the plain Request so a test constructs
 * one; 303 so the browser re-GETs the page it came from wearing the new preference.
 */
export async function setThemeResponse({
  request,
}: {
  readonly request: Request;
}): Promise<Response> {
  const form = await request.formData();
  const current = parseThemePreference(cookieValue(request.headers.get("cookie"), THEME_COOKIE));
  const next = nextPreference(current, form.get("mode"), form.get("theme"));
  return new Response(null, {
    status: 303,
    headers: {
      location: returnPath(request),
      "set-cookie": `${THEME_COOKIE}=${serializeThemePreference(next)}; Path=/; Max-Age=31536000; SameSite=Lax`,
    },
  });
}
