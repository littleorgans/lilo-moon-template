import { randomBytes } from "node:crypto";

import type { Principal } from "@lilo-moon/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedInPanel } from "../src/components/signed-in-panel.js";
import { signOut } from "../src/routes/api.auth.signout.js";
import { startAuthorization } from "../src/routes/api.auth.start.js";
import type { CookieJar, CookieOptions } from "../src/server/cookies.js";
import { countVisibleRows } from "../src/server/rows.js";
import { SESSION_COOKIE, STATE_COOKIE, seal } from "../src/server/session.js";
import { loadSignedOrRedirect, loadSignedView } from "../src/server/signed-in.js";

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

const key = randomBytes(32);

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: [],
};

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

describe("loadSignedView", () => {
  const deps = {
    cookieKey: key,
    verify: () => Promise.resolve(principal),
    runScoped: null,
  };

  it("returns null when there is no session cookie", async () => {
    const { jar } = jarWith();
    expect(await loadSignedView(jar, deps)).toBeNull();
  });

  it("returns null for a cookie sealed with someone else's key", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(randomBytes(32), { accessToken: "a", refreshToken: "r" }),
    });
    expect(await loadSignedView(jar, deps)).toBeNull();
  });

  it("verifies the access token rather than trusting the cookie's contents", async () => {
    const seen: string[] = [];
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "the-access-token", refreshToken: "r" }),
    });
    await loadSignedView(jar, {
      ...deps,
      verify: (token) => {
        seen.push(token);
        return Promise.resolve(principal);
      },
    });
    expect(seen).toStrictEqual(["the-access-token"]);
  });

  // A rejected token is not a signed-in state. Letting the failure escape is correct: the caller
  // turns it into a session-ended screen, and swallowing it here would render a page for a
  // Principal that was never proven.
  it("lets a verification failure escape rather than rendering a page", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "expired", refreshToken: "r" }),
    });
    await expect(
      loadSignedView(jar, { ...deps, verify: () => Promise.reject(new Error("expired")) }),
    ).rejects.toThrow("expired");
  });

  it("treats an absent database as a runnable state, not an error", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "a", refreshToken: "r" }),
    });
    expect(await loadSignedView(jar, deps)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // A database that is down must not hide the Principal. Seeing the claims is exactly what makes
  // the failure diagnosable.
  it("reports a database failure while still showing the verified Principal", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "a", refreshToken: "r" }),
    });
    const view = await loadSignedView(jar, {
      ...deps,
      runScoped: () => Promise.reject(new Error("connection refused")),
    });
    expect(view?.principal).toStrictEqual(principal);
    expect(view?.databaseError).toContain("connection refused");
  });

  it("counts rows through withPrincipal, never outside it", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "a", refreshToken: "r" }),
    });
    let scopedTo: Principal | null = null;
    // A plain object, no cast. CountingTransaction is structural precisely so this stays honest.
    const view = await loadSignedView(jar, {
      ...deps,
      runScoped: async (given, body) => {
        scopedTo = given;
        return await body({ execute: () => Promise.resolve({ rows: [{ count: 1 }] }) });
      },
    });
    expect(scopedTo).toStrictEqual(principal);
    expect(view?.rows).toStrictEqual({ accounts: 1, profiles: 1 });
  });
});

describe("SignedInPanel", () => {
  it("prints the whole Principal so the claims can be read off the screen", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("user_01HBEQ");
    expect(html).toContain("org_01M0");
    expect(html).toContain("billing:manage");
  });

  it("says plainly that no transaction ran when there is no database", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("DATABASE_URL is not set");
  });

  it("shows a database failure rather than hiding it behind an empty count", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError="connection refused" />,
    );
    expect(html).toContain("connection refused");
  });

  it("shows the row counts when the scoped transaction ran", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel
        principal={principal}
        rows={{ accounts: 1, profiles: 1 }}
        databaseError={null}
      />,
    );
    expect(html).toContain("accounts: 1");
    expect(html).toContain("profiles: 1");
  });
});

describe("countVisibleRows", () => {
  // A count query always returns a row, but reading `rows[0]` without a fallback is exactly the
  // kind of assumption that turns an empty result into a crash rather than a zero.
  it("reads zero rather than failing when the result is empty", async () => {
    const rows = await countVisibleRows(
      async (_principal, body) => await body({ execute: () => Promise.resolve({ rows: [] }) }),
      principal,
    );
    expect(rows).toStrictEqual({ accounts: 0, profiles: 0 });
  });

  it("counts accounts and profiles separately", async () => {
    const queries: string[] = [];
    const rows = await countVisibleRows(
      async (_principal, body) =>
        await body({
          execute: (query) => {
            queries.push(JSON.stringify(query.queryChunks ?? ""));
            return Promise.resolve({ rows: [{ count: queries.length }] });
          },
        }),
      principal,
    );
    expect(rows).toStrictEqual({ accounts: 1, profiles: 2 });
  });
});

describe("loadSignedOrRedirect", () => {
  const deps = { cookieKey: key, verify: () => Promise.resolve(principal), runScoped: null };

  it("returns the view when there is a session", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "a", refreshToken: "r" }),
    });
    expect(await loadSignedOrRedirect(jar, deps)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // Not signed in is a person, not a fault. It redirects rather than raising, and TanStack's
  // redirect is a Response rather than an Error, which is why this is not a rejects.toThrow.
  it("redirects rather than failing when there is no session", async () => {
    const { jar } = jarWith();
    const thrown: unknown = await loadSignedOrRedirect(jar, deps).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
  });
});
