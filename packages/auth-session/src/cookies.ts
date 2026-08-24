export interface CookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly path: string;
  readonly maxAge?: number;
}

/**
 * The narrow slice of cookie handling these handlers need.
 *
 * Declared structurally, and injected, for the same reason `ScopedClient` is in `packages/db`: the
 * handlers decide whether a sign-in is genuine, and a decision that can only be exercised inside a
 * live request context does not get exercised.
 *
 * It is also what keeps this package free of any web framework. The application supplies the
 * adapter, so swapping the framework is a few lines there rather than a rewrite here.
 */
export interface CookieJar {
  read(name: string): string | undefined;
  write(name: string, value: string, options: CookieOptions): void;
  clear(name: string): void;
}
