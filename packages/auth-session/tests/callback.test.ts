import { randomBytes } from "node:crypto";

import { WorkOSAuthError } from "@lilo-moon/auth-workos";
import type { Authentication, WorkOSAuth, WorkOSAuthFailure } from "@lilo-moon/auth-workos";
import { describe, expect, it } from "vitest";

import { ensureOrganization, handleCallback, organizationNameFor } from "../src/callback.js";
import type { CookieJar, CookieOptions } from "../src/cookies.js";
import type { CallbackFailure } from "../src/failure.js";
import { SESSION_COOKIE, STATE_COOKIE, readSession } from "../src/session.js";

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

const user = {
  id: "user_01HBEQ",
  email: "owner@example.com",
  emailVerified: true,
  profilePictureUrl: null,
  name: "Owner Example",
  firstName: "Owner",
  lastName: "Example",
} satisfies Authentication["user"];

const arrival: Authentication = {
  user,
  organizationId: null,
  accessToken: "access-without-org",
  refreshToken: "refresh-1",
};

type Call = { readonly method: string; readonly options: unknown };

const unavailable = (): never => {
  throw new Error("not part of these tests");
};

function authDouble(): { auth: WorkOSAuth; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    auth: {
      provisionOrganization(options) {
        calls.push({ method: "provisionOrganization", options });
        return Promise.resolve({ organizationId: "org_01M0", membershipId: "om_01" });
      },
      refreshTokens(options) {
        calls.push({ method: "refreshTokens", options });
        return Promise.resolve({
          user,
          organizationId: "org_01M0",
          accessToken: "access-with-org",
          refreshToken: "refresh-2",
        });
      },
      getAuthorizationUrl: unavailable,
      authenticateWithCode: unavailable,
      signInWithPassword: unavailable,
      sendMagicAuthCode: unavailable,
      verifyMagicAuthCode: unavailable,
      challengeMfa: unavailable,
      verifyMfa: unavailable,
    },
  };
}

describe("organizationNameFor", () => {
  it("uses the given name when the provider supplied one", () => {
    expect(organizationNameFor(user)).toBe("Owner's workspace");
  });

  // The email-code path carries no name at all, so the fallback is required rather than cosmetic.
  it("falls back to the full email address when there is no name", () => {
    expect(organizationNameFor({ ...user, firstName: null, name: null })).toBe("owner@example.com");
  });

  it("treats an empty name as no name", () => {
    expect(organizationNameFor({ ...user, firstName: "", name: "" })).toBe("owner@example.com");
  });

  // Not the local part. The organization name is what appears in a workspace switcher, and local
  // parts collide constantly.
  it("keeps the domain rather than using the local part", () => {
    expect(organizationNameFor({ ...user, firstName: null, name: null })).toContain("@example.com");
  });
});

describe("ensureOrganization", () => {
  it("creates the organization and refreshes, in that order", async () => {
    const { auth, calls } = authDouble();
    await ensureOrganization(auth, arrival);
    expect(calls.map((call) => call.method)).toStrictEqual([
      "provisionOrganization",
      "refreshTokens",
    ]);
  });

  // Membership does not retroactively appear in a token already minted. Without the refresh,
  // org_id stays absent for the life of the access token and every scoped query runs without a
  // tenant.
  it("returns a token that now carries the organization", async () => {
    const { auth } = authDouble();
    const result = await ensureOrganization(auth, arrival);
    expect(result.organizationId).toBe("org_01M0");
    expect(result.accessToken).toBe("access-with-org");
    expect(result.refreshToken).toBe("refresh-2");
  });

  it("names the new organization after the person", async () => {
    const { auth, calls } = authDouble();
    await ensureOrganization(auth, arrival);
    expect(calls[0]?.options).toMatchObject({
      name: "Owner's workspace",
      userId: "user_01HBEQ",
    });
  });

  // Two tabs finishing at once, or one delivery retried, must not leave a person holding two
  // organizations with no way to tell which is real.
  it("keys creation on the user so a repeated callback cannot make a second organization", async () => {
    const { auth, calls } = authDouble();
    await ensureOrganization(auth, arrival);
    expect(calls[0]?.options).toMatchObject({ idempotencyKey: "signup:user_01HBEQ" });
  });

  it("attaches no domains, so the organization cannot capture a colleague", async () => {
    const { auth, calls } = authDouble();
    await ensureOrganization(auth, arrival);
    expect(JSON.stringify(calls[0]?.options)).not.toContain("domain");
  });

  it("refreshes against the organization it just created", async () => {
    const { auth, calls } = authDouble();
    await ensureOrganization(auth, arrival);
    expect(calls[1]?.options).toStrictEqual({
      refreshToken: "refresh-1",
      organizationId: "org_01M0",
    });
  });

  // Someone signing in again already has a tenant. Creating another on every sign-in would be a
  // slow, silent disaster.
  it("does nothing at all for a user who already has an organization", async () => {
    const { auth, calls } = authDouble();
    const existing = { ...arrival, organizationId: "org_existing" };
    expect(await ensureOrganization(auth, existing)).toBe(existing);
    expect(calls).toStrictEqual([]);
  });
});

/** The handler's context, which is what TanStack hands a server route. */
const request = (query: string) => ({
  request: new Request(`http://localhost:5199/callback${query}`, {
    headers: { "user-agent": "probe/1.0" },
  }),
});

describe("handleCallback", () => {
  const key = randomBytes(32);
  const issued = "the-issued-state";

  const logged: CallbackFailure[] = [];

  function callbackDeps(auth: WorkOSAuth) {
    return {
      auth,
      cookieKey: key,
      secureCookies: false,
      signedInPath: "/app",
      log: (failure: CallbackFailure) => {
        logged.push(failure);
      },
    };
  }

  /** An exchange that fails the way the vendor fails: a translated error carrying a reason. */
  function refusingAuth(reason: WorkOSAuthFailure): WorkOSAuth {
    return {
      ...authDouble().auth,
      authenticateWithCode() {
        return Promise.reject(
          new WorkOSAuthError({ reason, message: "the vendor said no", cause: new Error("raw") }),
        );
      },
    };
  }

  function exchangingAuth(): { auth: WorkOSAuth; calls: Call[] } {
    const base = authDouble();
    return {
      calls: base.calls,
      auth: {
        ...base.auth,
        authenticateWithCode(options) {
          base.calls.push({ method: "authenticateWithCode", options });
          return Promise.resolve(arrival);
        },
      },
    };
  }

  // The whole point of `state`. Without this the callback cannot tell its own redirect from one an
  // attacker handed the browser, and sign-in still appears to work.
  it("refuses a state that does not match the one it issued", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(
      request("?code=abc&state=forged"),
      jar,
      callbackDeps(auth),
    );
    expect(response.status).toBe(400);
    expect(calls).toStrictEqual([]);
  });

  it("refuses when no state was ever issued", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith();
    const response = await handleCallback(request("?code=abc&state=x"), jar, callbackDeps(auth));
    expect(response.status).toBe(400);
    expect(calls).toStrictEqual([]);
  });

  it("refuses when the provider returned no state at all", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(request("?code=abc"), jar, callbackDeps(auth));
    expect(response.status).toBe(400);
    expect(calls).toStrictEqual([]);
  });

  it("exchanges nothing and sets no session when the state check fails", async () => {
    const { auth } = exchangingAuth();
    const { jar, written } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(request("?code=abc&state=forged"), jar, callbackDeps(auth));
    expect(written).toStrictEqual([]);
  });

  it("refuses a matching state with no code", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(request(`?state=${issued}`), jar, callbackDeps(auth));
    expect(response.status).toBe(400);
    expect(calls).toStrictEqual([]);
  });

  // A state left valid is a state that can be replayed. It is spent the moment it is checked, and
  // that has to happen even on the paths that fail afterwards.
  it("spends the state cookie once the check passes", async () => {
    const { auth } = exchangingAuth();
    const { jar, cleared } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(request(`?state=${issued}`), jar, callbackDeps(auth));
    expect(cleared).toContain(STATE_COOKIE);
  });

  it("exchanges the code, creates the organization, then lands on the app", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(auth),
    );
    expect(calls.map((call) => call.method)).toStrictEqual([
      "authenticateWithCode",
      "provisionOrganization",
      "refreshTokens",
    ]);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app");
  });

  it("passes the caller's user agent to the provider", async () => {
    const { auth, calls } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(request(`?code=the-code&state=${issued}`), jar, callbackDeps(auth));
    expect(calls[0]?.options).toMatchObject({ code: "the-code", userAgent: "probe/1.0" });
  });

  // The refreshed tokens, not the ones from the exchange. Sealing the originals would store a
  // token with no org_id and every scoped query would run without a tenant.
  it("seals the refreshed tokens into the session, not the pre-refresh ones", async () => {
    const { auth } = exchangingAuth();
    const { jar, written } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(request(`?code=the-code&state=${issued}`), jar, callbackDeps(auth));
    const session = written.find((cookie) => cookie.name === SESSION_COOKIE);
    expect(readSession(key, session?.value)).toStrictEqual({
      accessToken: "access-with-org",
      refreshToken: "refresh-2",
    });
  });

  it("makes the session cookie http-only and unreadable in the browser", async () => {
    const { auth } = exchangingAuth();
    const { jar, written } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(request(`?code=the-code&state=${issued}`), jar, callbackDeps(auth));
    const session = written.find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(session?.value).not.toContain("access-with-org");
  });

  // The landing path belongs to the application. Hardcoding it here would mean a second product
  // had to accept this one's route names.
  it("redirects to the path the application chose", async () => {
    const { auth } = exchangingAuth();
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(request(`?code=c&state=${issued}`), jar, {
      ...callbackDeps(auth),
      signedInPath: "/workspace",
    });
    expect(response.headers.get("location")).toBe("/workspace");
  });

  // The failure this whole path exists for. A wrong API key used to reach the browser as
  // `{"status":400,"message":"HTTPError"}`, which tells the person nothing and the operator less.
  it("renders a page when the provider refuses the exchange", async () => {
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("unauthorized")),
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Sign-in is not set up correctly here.");
  });

  it("tells someone to try again only when the failure is transient", async () => {
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("rate-limited")),
    );
    expect(await response.text()).toContain("Try again in a moment.");
  });

  // Catching an error to render a page swallows the stack trace the framework would have printed.
  // A callback that renders without reporting trades a bad page for a silent outage.
  it("reports the failure it just swallowed", async () => {
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    logged.length = 0;
    await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("configuration")),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ reason: "configuration", disposition: "misconfigured" });
    expect(logged[0]?.error).toBeInstanceOf(WorkOSAuthError);
  });

  it("never names the provider's reason in the page", async () => {
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    const response = await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("sso-required")),
    );
    const body = await response.text();
    expect(body).not.toContain("sso-required");
    expect(body).not.toContain("the vendor said no");
  });

  it("sets no session when the exchange fails", async () => {
    const { jar, written } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("unauthorized")),
    );
    expect(written).toStrictEqual([]);
  });

  // The state is spent before the exchange is attempted, so a failed exchange must not leave a
  // replayable one behind.
  it("still spends the state when the exchange fails", async () => {
    const { jar, cleared } = jarWith({ [STATE_COOKIE]: issued });
    await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(refusingAuth("unauthorized")),
    );
    expect(cleared).toContain(STATE_COOKIE);
  });

  // Organization creation runs after the exchange and can fail on its own. A raw throw there would
  // reach the browser exactly as the exchange's did.
  it("renders a page when provisioning fails rather than the exchange", async () => {
    const base = authDouble();
    const auth: WorkOSAuth = {
      ...base.auth,
      authenticateWithCode: () => Promise.resolve(arrival),
      provisionOrganization: () => Promise.reject(new Error("no network")),
    };
    const { jar } = jarWith({ [STATE_COOKIE]: issued });
    logged.length = 0;
    const response = await handleCallback(
      request(`?code=the-code&state=${issued}`),
      jar,
      callbackDeps(auth),
    );
    expect(response.status).toBe(400);
    expect(logged[0]).toMatchObject({ reason: "provider" });
  });
});
