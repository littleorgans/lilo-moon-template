import type { CookieJar, CookieOptions } from "../src/cookies.js";

export interface Written {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
}

/** A jar that records instead of touching a request, shared by every handler test. */
export function jarWith(present: Readonly<Record<string, string>> = {}): {
  jar: CookieJar;
  written: Written[];
  cleared: string[];
} {
  const written: Written[] = [];
  const cleared: string[] = [];
  return {
    written,
    cleared,
    jar: {
      read: (name) => present[name],
      write: (name, value, options) => {
        written.push({ name, value, options });
      },
      clear: (name) => {
        cleared.push(name);
      },
    },
  };
}
