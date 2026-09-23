import type { CookieJar, CookieOptions } from "../src/cookies.js";
import type { Throttle, ThrottleKey } from "../src/throttle.js";

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

/**
 * A throttle that records every key it is asked about and allows all of them unless told which to
 * refuse. The test double for `Throttle`: no clock, no counting, just the decision under test.
 */
export function throttleDouble(refuse: (key: ThrottleKey) => number | null = () => null): {
  throttle: Throttle;
  asked: ThrottleKey[];
} {
  const asked: ThrottleKey[] = [];
  return {
    asked,
    throttle: (key) => {
      asked.push(key);
      const retryAfterSeconds = refuse(key);
      return Promise.resolve(
        retryAfterSeconds === null ? { allowed: true } : { allowed: false, retryAfterSeconds },
      );
    },
  };
}
