import { randomBytes } from "node:crypto";
import { setTimeout as nextTurn } from "node:timers/promises";
import { inspect } from "node:util";

import { AuthError } from "@littleorgans/auth";
import type { Principal, Verifier } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth } from "@littleorgans/auth-workos";
import { afterEach, describe, expect, it } from "vitest";

import { readAccess, refreshesInFlight } from "../src/access.js";
import { readUserAccess } from "../src/delegate.js";
import type { UserAccess, UserAccessDeps } from "../src/delegate.js";
import type { TokenFailure } from "../src/failure.js";
import { SESSION_COOKIE, readSession, seal } from "../src/session.js";
import { jarWith } from "./support.js";

const cookieKey = randomBytes(32);
const service = "https://api.example.com";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

// Distinctive enough that finding either one anywhere in a value can only mean it leaked.
const ACCESS = "access-1-secret-xq7";
const RENEWED = "access-2-secret-zp4";

const renewal: Authentication = {
  user: {
    id: principal.userId,
    email: "owner@example.com",
    emailVerified: true,
    profilePictureUrl: null,
    name: null,
    firstName: null,
    lastName: null,
  },
  organizationId: "org_01M0",
  accessToken: RENEWED,
  refreshToken: "refresh-2",
};

const unavailable = (): never => {
  throw new Error("not part of these tests");
};

function authDouble(refresh: () => Promise<Authentication> = () => Promise.resolve(renewal)): {
  auth: WorkOSAuth;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    auth: {
      refreshTokens(options) {
        calls.push(options);
        return refresh();
      },
      getLogoutUrl: unavailable,
      getAuthorizationUrl: unavailable,
      authenticateWithCode: unavailable,
      signInWithPassword: unavailable,
      sendMagicAuthCode: unavailable,
      verifyMagicAuthCode: unavailable,
      challengeMfa: unavailable,
      verifyMfa: unavailable,
      provisionOrganization: unavailable,
    },
  };
}

interface Sent {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly authorization: string | null;
}

/** Records what would have gone over the wire and answers 200, so no service needs to listen. */
function sender(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init) => {
      sent.push({
        url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
        init,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(new Response("ok"));
    },
  };
}

function depsWith(
  verify: Verifier,
  auth: WorkOSAuth = authDouble().auth,
  serviceOrigins: readonly string[] = [service],
) {
  const logged: TokenFailure[] = [];
  const wire = sender();
  const deps: UserAccessDeps = {
    cookieKey,
    secureCookies: false,
    verify,
    auth,
    log: (failure) => logged.push(failure),
    serviceOrigins,
    fetch: wire.fetch,
  };
  return { deps, logged, sent: wire.sent };
}

const valid: Verifier = () => Promise.resolve(principal);
const expiredThenValid: Verifier = (token) =>
  token === ACCESS
    ? Promise.reject(new AuthError("expired", "token expired"))
    : Promise.resolve(principal);
const rejects =
  (reason: "signature" | "claims" | "malformed"): Verifier =>
  () =>
    Promise.reject(new AuthError(reason, `token ${reason}`));

const session = () =>
  jarWith({
    [SESSION_COOKIE]: seal(cookieKey, { accessToken: ACCESS, refreshToken: "refresh-1" }),
  });

function signedIn(user: UserAccess) {
  if (user.status !== "signed-in") throw new Error(`Expected signed-in, got ${user.status}`);
  return user;
}

/**
 * Every string reachable from a value by reflection: own properties, enumerable or not, keyed by
 * name or symbol, through objects, arrays and functions. What a serialiser or an inspector could
 * possibly find. A closure's variables are not reachable this way, which is the point.
 */
function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const strings: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string") strings.push(key);
    strings.push(...reachableStrings(Reflect.getOwnPropertyDescriptor(value, key)?.value, seen));
  }
  return strings;
}

function expectNoToken(value: unknown): void {
  const views = [
    JSON.stringify(value) ?? "",
    inspect(value, { depth: Infinity, showHidden: true, getters: true }),
    ...reachableStrings(value),
  ];
  for (const view of views) {
    expect(view).not.toContain(ACCESS);
    expect(view).not.toContain(RENEWED);
  }
}

describe("fetch as the signed-in person", () => {
  it("sends the verified token as the bearer, and passes everything else through", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    const response = await user.fetch(`${service}/v1/me`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "r1" },
      body: "{}",
    });

    expect(await response.text()).toBe("ok");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${service}/v1/me`);
    expect(sent[0]?.authorization).toBe(`Bearer ${ACCESS}`);
    expect(sent[0]?.init?.method).toBe("POST");
    expect(sent[0]?.init?.body).toBe("{}");
    const headers = new Headers(sent[0]?.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-request-id")).toBe("r1");
  });

  // Appending would send two credentials joined by a comma, and auth-http refuses that pair as
  // malformed. Replacing makes the person's token the only one that travels.
  it("replaces an Authorization header the caller set", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await user.fetch(new URL("/v1/me", service), { headers: { authorization: "Bearer other" } });

    expect(sent[0]?.authorization).toBe(`Bearer ${ACCESS}`);
  });

  it.each([
    ["another host", "https://evil.example/v1/me"],
    ["a suffix of the host", "https://api.example.com.evil.example/v1/me"],
    ["the same host over http", "http://api.example.com/v1/me"],
    ["the same host on another port", "https://api.example.com:8443/v1/me"],
  ])("refuses %s without sending anything", async (_, url) => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch(url)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });

  // A relative URL has no origin of its own to check. Resolving it against anything would be this
  // helper choosing a destination for the token.
  it("refuses a relative URL", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch("/v1/me")).rejects.toThrow(TypeError);
    expect(sent).toHaveLength(0);
  });

  it("refuses every call when no service origins are configured", async () => {
    const { deps, sent } = depsWith(valid, authDouble().auth, []);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch(`${service}/v1/me`)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });
});

describe("the token never leaves the closure", () => {
  it("is absent from the signed-in value, however it is read", async () => {
    const { deps } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    expectNoToken(user);
    expectNoToken(user.principal);
    expect(Object.keys(user).toSorted()).toStrictEqual(["fetch", "principal", "status"]);
  });

  it("is absent after a refresh too, and from what readAccess returns", async () => {
    const { deps } = depsWith(expiredThenValid);

    expectNoToken(await readUserAccess(session().jar, deps));
    expectNoToken(await readAccess(session().jar, deps));
  });

  // JSON is the lowest common denominator of what a loader's value becomes on the way to the
  // browser. Only the status and the Principal survive; the function does not.
  it("serialises to the status and the Principal alone", async () => {
    const { deps } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    expect(JSON.parse(JSON.stringify(user))).toStrictEqual({ status: "signed-in", principal });
  });
});

describe("an expired token", () => {
  afterEach(() => {
    expect(refreshesInFlight()).toBe(0);
  });

  it("is refreshed before anything is sent, and the renewed token is the bearer", async () => {
    const { jar, written } = session();
    const { auth, calls } = authDouble();
    const { deps, sent } = depsWith(expiredThenValid, auth);

    const user = signedIn(await readUserAccess(jar, deps));
    await user.fetch(`${service}/v1/me`);

    expect(calls).toStrictEqual([{ refreshToken: "refresh-1" }]);
    expect(sent[0]?.authorization).toBe(`Bearer ${RENEWED}`);
    expect(readSession(cookieKey, written[0]?.value)).toStrictEqual({
      accessToken: RENEWED,
      refreshToken: "refresh-2",
    });
  });

  // The helper has no refresh of its own. It joins the in-flight call readAccess would, so a loader
  // reading Access and a server function calling a service in the same moment spend the token once.
  it("shares one provider call with concurrent readers of either kind", async () => {
    let settle: (value: Authentication) => void = unavailable;
    const pending = new Promise<Authentication>((resolve) => {
      settle = resolve;
    });
    const { auth, calls } = authDouble(() => pending);
    const { deps, sent } = depsWith(expiredThenValid, auth);

    const users = [session(), session(), session()].map(({ jar }) => readUserAccess(jar, deps));
    const access = readAccess(session().jar, deps);
    await nextTurn(0);
    expect(calls).toHaveLength(1);
    expect(refreshesInFlight()).toBe(1);

    settle(renewal);
    await Promise.all(
      (await Promise.all(users)).map((user) => signedIn(user).fetch(`${service}/v1/me`)),
    );

    expect(await access).toStrictEqual({ status: "signed-in", principal });
    expect(calls).toHaveLength(1);
    expect(sent.map((request) => request.authorization)).toStrictEqual(
      Array.from({ length: 3 }, () => `Bearer ${RENEWED}`),
    );
  });
});

// The same five states as Access, as values. Strict equality also proves no failure state carries a
// fetch: only a verified session can call anything.
describe("when there is no usable session", () => {
  it("is anonymous without a cookie", async () => {
    const { deps } = depsWith(valid);
    expect(await readUserAccess(jarWith().jar, deps)).toStrictEqual({ status: "anonymous" });
  });

  it("ends a session whose token will not verify, and clears the cookie", async () => {
    const { jar, cleared } = session();
    const { deps, logged } = depsWith(rejects("signature"));

    expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["signature"]);
  });

  it("ends a session whose refresh is refused", async () => {
    const { jar, cleared } = session();
    const { auth } = authDouble(() =>
      Promise.reject(
        new WorkOSAuthError({ reason: "unauthorized", message: "invalid_grant", cause: undefined }),
      ),
    );
    const { deps, sent } = depsWith(expiredThenValid, auth);

    expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(sent).toHaveLength(0);
  });

  it.each(["rate-limited", "unavailable"] as const)(
    "is unavailable, keeping the cookie, when the refresh is %s",
    async (reason) => {
      const { jar, cleared } = session();
      const { auth } = authDouble(() =>
        Promise.reject(new WorkOSAuthError({ reason, message: "try later", cause: undefined })),
      );
      const { deps } = depsWith(expiredThenValid, auth);

      expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "unavailable" });
      expect(cleared).toHaveLength(0);
    },
  );

  it("is broken when the token's claims are the wrong shape", async () => {
    const { deps } = depsWith(rejects("claims"));
    expect(await readUserAccess(session().jar, deps)).toStrictEqual({ status: "broken" });
  });
});

describe("service origins", () => {
  it.each([
    ["plain http off localhost", "http://api.example.com", "must use HTTPS"],
    ["a path", "https://api.example.com/v1", "origin only"],
    ["a query", "https://api.example.com/?v=1", "origin only"],
    ["a user name", "https://operator@api.example.com", "origin only"],
  ])("refuses %s before the session is read", async (_, origin, message) => {
    let reads = 0;
    const { deps } = depsWith(valid, authDouble().auth, [origin]);
    const jar = { ...jarWith().jar, read: () => ((reads += 1), undefined) };

    await expect(readUserAccess(jar, deps)).rejects.toThrow(message);
    expect(reads).toBe(0);
  });

  it.each([
    ["http on localhost", "http://localhost:8787", "http://localhost:8787/v1/me"],
    ["a trailing slash and a default port", "https://API.example.com:443/", `${service}/v1/me`],
  ])("accepts %s", async (_, origin, url) => {
    const { deps, sent } = depsWith(valid, authDouble().auth, [origin]);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await user.fetch(url);
    expect(sent.map((request) => request.url)).toStrictEqual([url]);
  });
});
