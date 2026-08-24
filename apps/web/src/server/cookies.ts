import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

export interface CookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly path: string;
  readonly maxAge?: number;
}

/**
 * The narrow slice of cookie handling the server routes need.
 *
 * Declared structurally, and injected, for the same reason `ScopedClient` is in `packages/db`: the
 * handlers below decide whether a sign-in is genuine, and a decision that can only be exercised
 * inside a live request context does not get exercised. A recording double makes the sequence
 * inspectable, which is the whole point.
 */
export interface CookieJar {
  read(name: string): string | undefined;
  write(name: string, value: string, options: CookieOptions): void;
  clear(name: string): void;
}

/** The real jar, bound to the in-flight request. */
export const requestCookies: CookieJar = {
  read: (name) => getCookie(name),
  write: (name, value, options) => {
    setCookie(name, value, options);
  },
  clear: (name) => {
    deleteCookie(name, { path: "/" });
  },
};
