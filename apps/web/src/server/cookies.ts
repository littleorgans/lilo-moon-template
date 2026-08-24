import type { CookieJar } from "@lilo-moon/auth-session";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

/**
 * The framework adapter, and the only place this application knows how cookies reach the wire.
 *
 * `CookieJar` is declared in `@lilo-moon/auth-session` so that package stays free of any web
 * framework. Everything framework-specific about cookies is these eight lines.
 */
export const requestCookies: CookieJar = {
  read: (name) => getCookie(name),
  write: (name, value, options) => {
    setCookie(name, value, options);
  },
  clear: (name) => {
    deleteCookie(name, { path: "/" });
  },
};
