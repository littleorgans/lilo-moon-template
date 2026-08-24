import { describe, expect, it } from "vitest";

import { startAuthorization } from "../src/authorize.js";
import type { CookieJar, CookieOptions } from "../src/cookies.js";
import { STATE_COOKIE } from "../src/session.js";
import { SESSION_COOKIE } from "../src/session.js";
import { signOut } from "../src/signout.js";

interface Written {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
}

function jarWith(present: Readonly<Record<string, string>> = {}): {
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

describe("startAuthorization", () => {
  const deps = {
    authorizationUrl: (state: string) => `https://api.workos.com/authorize?state=${state}`,
    secureCookies: false,
  };

  it("redirects to the provider", () => {
    const { jar } = jarWith();
    const response = startAuthorization(null, jar, deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("api.workos.com/authorize");
  });

  // The state that goes in the cookie must be the state that goes in the URL, or the callback
  // compares two unrelated values and no sign-in can ever complete.
  it("puts the same state in the cookie and the url", () => {
    const { jar, written } = jarWith();
    const response = startAuthorization(null, jar, deps);
    const issued = written[0];
    expect(issued?.name).toBe(STATE_COOKIE);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("state")).toBe(
      issued?.value,
    );
  });

  it("issues a different state on every attempt", () => {
    const first = jarWith();
    const second = jarWith();
    startAuthorization(null, first.jar, deps);
    startAuthorization(null, second.jar, deps);
    expect(first.written[0]?.value).not.toBe(second.written[0]?.value);
  });

  // Strict would withhold this cookie on the callback, which arrives as a top-level navigation from
  // the provider's origin. Sign-in would then fail every time, for a reason that looks like a
  // provider fault. This assertion is the one that catches a well-meaning tightening.
  it("scopes the state cookie SameSite=Lax, http-only, on the root path", () => {
    const { jar, written } = jarWith();
    startAuthorization(null, jar, deps);
    expect(written[0]?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("expires the state rather than leaving it valid indefinitely", () => {
    const { jar, written } = jarWith();
    startAuthorization(null, jar, deps);
    expect(written[0]?.options.maxAge).toBeGreaterThan(0);
  });

  it("follows the configuration on Secure so localhost is not silently cookie-less", () => {
    const { jar, written } = jarWith();
    startAuthorization(null, jar, { ...deps, secureCookies: true });
    expect(written[0]?.options.secure).toBe(true);
  });
});

describe("signOut", () => {
  it("clears the session cookie and returns to sign in", () => {
    const { jar, cleared } = jarWith();
    const response = signOut(null, jar);
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });
});
