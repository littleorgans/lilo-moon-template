import { createHash, randomBytes } from "node:crypto";
import { setTimeout as nextTurn } from "node:timers/promises";

import { AuthError } from "@littleorgans/auth";
import type { Principal, Verifier } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth } from "@littleorgans/auth-workos";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_MARGIN_SECONDS, readAccess, refreshesInFlight } from "../src/access.js";
import type { AccessDeps } from "../src/access.js";
import type { TokenFailure } from "../src/failure.js";
import { SESSION_COOKIE, readSession, seal } from "../src/session.js";
import { jarWith } from "./support.js";
import { NOW, createSigner, freezeClock, verifierFor } from "./tokens.js";

const cookieKey = randomBytes(32);

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

const refreshed: Authentication = {
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
  accessToken: "access-2",
  refreshToken: "refresh-2",
};

const unavailable = (): never => {
  throw new Error("not part of these tests");
};

/** Only `refreshTokens` is reachable; anything else this touched would be a bug in the reader. */
function authDouble(refresh: () => Promise<Authentication> = () => Promise.resolve(refreshed)): {
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
      getLogoutUrl: () => {
        throw new Error("unexpected logout");
      },
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

function depsWith(
  verify: Verifier,
  auth: WorkOSAuth,
): { deps: AccessDeps; logged: TokenFailure[] } {
  const logged: TokenFailure[] = [];
  return {
    logged,
    deps: {
      cookieKey,
      secureCookies: false,
      verify,
      auth,
      log: (failure) => logged.push(failure),
    },
  };
}

const sealed = (accessToken: string) => seal(cookieKey, { accessToken, refreshToken: "refresh-1" });

const rejects =
  (reason: "expired" | "signature" | "claims" | "malformed"): Verifier =>
  () =>
    Promise.reject(new AuthError(reason, `token ${reason}`));

describe("readAccess", () => {
  it("is anonymous when no cookie is present", async () => {
    const { deps } = depsWith(() => Promise.resolve(principal), authDouble().auth);
    expect(await readAccess(jarWith().jar, deps)).toStrictEqual({ status: "anonymous" });
  });

  it("is anonymous when the cookie does not open with our key", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(randomBytes(32), { accessToken: "a", refreshToken: "r" }),
    });
    const { deps } = depsWith(() => Promise.resolve(principal), authDouble().auth);
    expect(await readAccess(jar, deps)).toStrictEqual({ status: "anonymous" });
  });

  it("returns the verified Principal and touches nothing else", async () => {
    const { jar, written, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { auth, calls } = authDouble();
    const { deps, logged } = depsWith((token) => {
      expect(token).toBe("access-1");
      return Promise.resolve(principal);
    }, auth);

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
    expect(calls).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(cleared).toHaveLength(0);
    expect(logged).toHaveLength(0);
  });
});

describe("an expired token", () => {
  // Expiry is the common case rather than a failure: the token lives 300 seconds, so a person
  // reading a page for six minutes reaches this path.
  it("is refreshed silently, verified again, and resealed", async () => {
    const { jar, written } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { auth, calls } = authDouble();
    let seen = 0;
    const { deps, logged } = depsWith((token) => {
      seen += 1;
      return token === "access-1"
        ? Promise.reject(new AuthError("expired", "token expired"))
        : Promise.resolve(principal);
    }, auth);

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
    // No organizationId: refreshing without one preserves the org already in the token, measured
    // against the live provider. Passing one here would be this reader inventing a tenant.
    expect(calls).toStrictEqual([{ refreshToken: "refresh-1" }]);
    expect(seen).toBe(2);
    expect(readSession(cookieKey, written[0]?.value)).toStrictEqual({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    expect(logged).toHaveLength(0);
  });

  it("ends the session when the refresh itself is refused", async () => {
    const { jar, written, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { auth } = authDouble(() =>
      Promise.reject(
        new WorkOSAuthError({
          reason: "unauthorized",
          message: "refresh token revoked",
          cause: undefined,
        }),
      ),
    );
    const { deps, logged } = depsWith(rejects("expired"), auth);

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(written).toHaveLength(0);
    expect(logged).toHaveLength(1);
  });

  // The replacement is verified like any other token. A refresh that returns something unusable
  // must not be trusted for having arrived over TLS.
  it("does not reseal a refreshed token that fails verification", async () => {
    const { jar, written, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { auth, calls } = authDouble();
    const { deps, logged } = depsWith(
      (token) =>
        Promise.reject(new AuthError(token === "access-1" ? "expired" : "signature", "rejected")),
      auth,
    );

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(written).toHaveLength(0);
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["signature"]);
    expect(calls).toHaveLength(1);
  });
});

describe("a token that will not verify", () => {
  it.each(["signature", "malformed"] as const)(
    "ends the session on %s, clears the cookie, and reports it",
    async (reason) => {
      const { jar, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
      const { auth, calls } = authDouble();
      const { deps, logged } = depsWith(rejects(reason), auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
      expect(cleared).toStrictEqual([SESSION_COOKIE]);
      // Never refreshed: only expiry is worth spending a round trip on, and a bad signature is
      // exactly the case where retrying with the provider would be the wrong instinct.
      expect(calls).toHaveLength(0);
      expect(logged).toStrictEqual([
        { kind: "token", reason, status: "ended", error: expect.any(AuthError) },
      ]);
    },
  );

  // Signature good, shape wrong. Ours, so the cookie survives: the person is still signed in and
  // signing in again would mint the same unreadable token.
  it("reports a claims failure as broken and leaves the session alone", async () => {
    const { jar, cleared, written } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { deps, logged } = depsWith(rejects("claims"), authDouble().auth);

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "broken" });
    expect(cleared).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(logged.map((failure) => failure.status)).toStrictEqual(["broken"]);
  });

  // A throw that is not an AuthError never came from the verifier's own classification, so it gets
  // the most conservative reading available rather than being reported as something it is not.
  it("preserves the session on an unclassified infrastructure failure", async () => {
    const { jar } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { deps, logged } = depsWith(
      () => Promise.reject(new Error("socket closed")),
      authDouble().auth,
    );

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "unavailable" });
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["unavailable"]);
  });
});

describe("temporary provider failures", () => {
  it.each(["rate-limited", "unavailable"] as const)(
    "preserves the session on %s",
    async (reason) => {
      const { jar, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
      const { auth } = authDouble(() =>
        Promise.reject(new WorkOSAuthError({ reason, message: "try later", cause: undefined })),
      );
      const { deps, logged } = depsWith(rejects("expired"), auth);
      expect(await readAccess(jar, deps)).toEqual({ status: "unavailable" });
      expect(cleared).toEqual([]);
      expect(logged[0]?.reason).toBe(reason);
    },
  );
});

it("keeps rotated refresh credentials when verification is temporarily unavailable", async () => {
  const { jar, written, cleared } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
  const { deps } = depsWith(
    (token) =>
      Promise.reject(
        new AuthError(token === "access-1" ? "expired" : "unavailable", "keys unavailable"),
      ),
    authDouble().auth,
  );
  expect(await readAccess(jar, deps)).toEqual({ status: "unavailable" });
  expect(cleared).toEqual([]);
  expect(readSession(cookieKey, written[0]?.value)).toEqual({
    accessToken: "access-2",
    refreshToken: "refresh-2",
  });
});

/** A refresh that stays in flight until the test settles it, so callers can pile up behind it. */
function deferred(): {
  promise: Promise<Authentication>;
  resolve: (value: Authentication) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: Authentication) => void = unavailable;
  let reject: (error: unknown) => void = unavailable;
  const promise = new Promise<Authentication>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** One jar per request, each carrying the same expired session, as parallel requests would. */
function requests(count: number, refreshToken = "refresh-1") {
  return Array.from({ length: count }, () =>
    jarWith({ [SESSION_COOKIE]: seal(cookieKey, { accessToken: "access-1", refreshToken }) }),
  );
}

const expiredThenValid: Verifier = (token) =>
  token === "access-1"
    ? Promise.reject(new AuthError("expired", "token expired"))
    : Promise.resolve(principal);

const reused = () =>
  new WorkOSAuthError({ reason: "unauthorized", message: "invalid_grant", cause: undefined });

// WorkOS rotates the refresh token on every use. Parallel requests for one session must spend it
// once: a loser refused with invalid_grant would otherwise clear the cookie the winner just wrote.
describe("concurrent refreshes of one session", () => {
  afterEach(() => {
    expect(refreshesInFlight()).toBe(0);
  });

  it("make exactly one provider call and write three identical sessions", async () => {
    const pending = deferred();
    const { auth, calls } = authDouble(() => pending.promise);
    const verified: string[] = [];
    const { deps, logged } = depsWith((token) => {
      verified.push(token);
      return expiredThenValid(token);
    }, auth);
    const jars = requests(3);

    const readers = jars.map(({ jar }) => readAccess(jar, deps));
    // A full turn drains every microtask, so each reader has reached the refresh while the first
    // call is still in flight. Without sharing, there would be three calls by now.
    await nextTurn(0);
    expect(verified).toStrictEqual(["access-1", "access-1", "access-1"]);
    expect(calls).toHaveLength(1);
    expect(refreshesInFlight()).toBe(1);

    pending.resolve(refreshed);
    const results = await Promise.all(readers);

    expect(calls).toStrictEqual([{ refreshToken: "refresh-1" }]);
    expect(results).toStrictEqual(
      Array.from({ length: 3 }, () => ({ status: "signed-in", principal })),
    );
    // Only the provider call is shared. Each request verifies the result and writes its own cookie.
    expect(verified.filter((token) => token === "access-2")).toHaveLength(3);
    for (const { written, cleared } of jars) {
      expect(written).toHaveLength(1);
      expect(readSession(cookieKey, written[0]?.value)).toStrictEqual({
        accessToken: "access-2",
        refreshToken: "refresh-2",
      });
      expect(cleared).toHaveLength(0);
    }
    expect(logged).toHaveLength(0);
  });

  it("reject every waiter when the shared call fails, then let the next request retry", async () => {
    const pending = deferred();
    let attempt = 0;
    const { auth, calls } = authDouble(() => {
      attempt += 1;
      return attempt === 1 ? pending.promise : Promise.resolve(refreshed);
    });
    const { deps, logged } = depsWith(expiredThenValid, auth);
    const jars = requests(3);

    const readers = jars.map(({ jar }) => readAccess(jar, deps));
    await nextTurn(0);
    expect(refreshesInFlight()).toBe(1);
    pending.reject(reused());

    // The existing classification holds for every waiter: invalid_grant ends the session.
    expect(await Promise.all(readers)).toStrictEqual(
      Array.from({ length: 3 }, () => ({ status: "ended" })),
    );
    for (const { cleared, written } of jars) {
      expect(cleared).toStrictEqual([SESSION_COOKIE]);
      expect(written).toHaveLength(0);
    }
    expect(logged.map((failure) => failure.status)).toStrictEqual(["ended", "ended", "ended"]);
    expect(calls).toHaveLength(1);
    expect(refreshesInFlight()).toBe(0);

    // Nothing was remembered: the same token is refreshed afresh rather than failed from memory.
    const [next] = requests(1);
    if (next === undefined) throw new Error("no request");
    expect(await readAccess(next.jar, deps)).toStrictEqual({ status: "signed-in", principal });
    expect(calls).toHaveLength(2);
  });

  it("keep every waiter's cookie on a temporary failure", async () => {
    const pending = deferred();
    const { auth, calls } = authDouble(() => pending.promise);
    const { deps } = depsWith(expiredThenValid, auth);
    const jars = requests(2);

    const readers = jars.map(({ jar }) => readAccess(jar, deps));
    await nextTurn(0);
    expect(refreshesInFlight()).toBe(1);
    pending.reject(
      new WorkOSAuthError({ reason: "unavailable", message: "503", cause: undefined }),
    );

    expect(await Promise.all(readers)).toStrictEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    for (const { cleared } of jars) expect(cleared).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("do not share a call between different sessions", async () => {
    const { auth, calls } = authDouble();
    const { deps } = depsWith(expiredThenValid, auth);
    const jars = [...requests(1, "refresh-a"), ...requests(1, "refresh-b")];

    await Promise.all(jars.map(({ jar }) => readAccess(jar, deps)));

    expect(calls).toStrictEqual([{ refreshToken: "refresh-a" }, { refreshToken: "refresh-b" }]);
  });

  it("do not merge a later refresh into one that has already settled", async () => {
    const { auth, calls } = authDouble();
    const { deps } = depsWith(expiredThenValid, auth);
    const [first, second] = requests(2);
    if (first === undefined || second === undefined) throw new Error("no request");

    await readAccess(first.jar, deps);
    await readAccess(second.jar, deps);

    expect(calls).toHaveLength(2);
  });

  // A client that throws instead of rejecting must not leave an entry that every later refresh of
  // this session would join and fail on.
  it("do not leak an entry when the client throws synchronously", async () => {
    let attempt = 0;
    const { auth, calls } = authDouble(() => {
      attempt += 1;
      if (attempt === 1) throw new Error("socket closed");
      return Promise.resolve(refreshed);
    });
    const { deps } = depsWith(expiredThenValid, auth);
    const [first, second] = requests(2);
    if (first === undefined || second === undefined) throw new Error("no request");

    expect(await readAccess(first.jar, deps)).toStrictEqual({ status: "unavailable" });
    expect(refreshesInFlight()).toBe(0);
    expect(await readAccess(second.jar, deps)).toStrictEqual({ status: "signed-in", principal });
    expect(calls).toHaveLength(2);
  });

  it("never key the in-flight map by the raw refresh token", async () => {
    const set = vi.spyOn(Map.prototype, "set");
    try {
      const { auth } = authDouble();
      const { deps } = depsWith(expiredThenValid, auth);
      const [request] = requests(1, "refresh-secret");
      if (request === undefined) throw new Error("no request");
      await readAccess(request.jar, deps);
      const keys = set.mock.calls.map(([key]) => key);
      expect(keys).not.toContain("refresh-secret");
      expect(keys).toContain(createHash("sha256").update("refresh-secret").digest("hex"));
    } finally {
      set.mockRestore();
    }
  });
});

// Signed tokens with a real `exp`, through the real verifier, at a frozen clock. The stubs above
// verify strings that are not JWTs, which have no expiry to be near.
const provider = await createSigner();
// A key the verifier does not trust, under the trusted key's `kid`.
const forger = await createSigner();

const invalidGrant = () => Promise.reject(reused());
const outage = (reason: "unavailable" | "rate-limited") => () =>
  Promise.reject(new WorkOSAuthError({ reason, message: "try later", cause: undefined }));

// Encoded by hand: jose's own types will not build an `exp` that is not a number.
const unsigned = (payload: unknown) =>
  [{ alg: "none" }, payload]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".") + ".";

describe("a token near its expiry", () => {
  const verify = verifierFor(provider);
  const renewedPrincipal: Principal = { ...principal, roles: ["admin"] };

  beforeEach(freezeClock);
  afterEach(() => {
    vi.useRealTimers();
    expect(refreshesInFlight()).toBe(0);
  });

  /** A session whose access token expires `secondsLeft` from now, and the renewal WorkOS returns. */
  async function nearing(secondsLeft: number) {
    const accessToken = await provider.sign(secondsLeft, { roles: ["member"] });
    const renewal: Authentication = {
      ...refreshed,
      accessToken: await provider.sign(300, { roles: ["admin"] }),
    };
    const request = () =>
      jarWith({ [SESSION_COOKIE]: seal(cookieKey, { accessToken, refreshToken: "refresh-1" }) });
    return { accessToken, renewal, request };
  }

  it.each([REFRESH_MARGIN_SECONDS + 1, 299])(
    "is served as it is with %s seconds left",
    async (secondsLeft) => {
      const { request } = await nearing(secondsLeft);
      const { jar, written, cleared } = request();
      const { auth, calls } = authDouble();
      const { deps, logged } = depsWith(verify, auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
      expect(calls).toHaveLength(0);
      expect(written).toHaveLength(0);
      expect(cleared).toHaveLength(0);
      expect(logged).toHaveLength(0);
    },
  );

  // Down to the second: the margin is inclusive, and a token with one second left is inside it.
  it.each([REFRESH_MARGIN_SECONDS, REFRESH_MARGIN_SECONDS - 1, 1, 0])(
    "is refreshed with %s seconds left, returning the new token's Principal and resealing",
    async (secondsLeft) => {
      const { request, renewal } = await nearing(secondsLeft);
      const { jar, written, cleared } = request();
      const { auth, calls } = authDouble(() => Promise.resolve(renewal));
      const { deps, logged } = depsWith(verify, auth);

      expect(await readAccess(jar, deps)).toStrictEqual({
        status: "signed-in",
        principal: renewedPrincipal,
      });
      expect(calls).toStrictEqual([{ refreshToken: "refresh-1" }]);
      expect(readSession(cookieKey, written[0]?.value)).toStrictEqual({
        accessToken: renewal.accessToken,
        refreshToken: "refresh-2",
      });
      expect(cleared).toHaveLength(0);
      expect(logged).toHaveLength(0);
    },
  );

  // Past `exp` but within the verifier's five seconds of tolerance, the token still verifies, and
  // the margin is what refreshes it rather than letting it travel already expired.
  it("is refreshed when it has expired but still verifies within the clock tolerance", async () => {
    const { request, renewal } = await nearing(-3);
    const { jar, written } = request();
    const { auth, calls } = authDouble(() => Promise.resolve(renewal));
    const { deps } = depsWith(verify, auth);

    expect(await readAccess(jar, deps)).toStrictEqual({
      status: "signed-in",
      principal: renewedPrincipal,
    });
    expect(calls).toHaveLength(1);
    expect(written).toHaveLength(1);
  });

  describe("once it has expired, the existing path", () => {
    it("refreshes and reseals", async () => {
      const { request, renewal } = await nearing(-60);
      const { jar, written } = request();
      const { auth, calls } = authDouble(() => Promise.resolve(renewal));
      const { deps, logged } = depsWith(verify, auth);

      expect(await readAccess(jar, deps)).toStrictEqual({
        status: "signed-in",
        principal: renewedPrincipal,
      });
      expect(calls).toHaveLength(1);
      expect(readSession(cookieKey, written[0]?.value)?.accessToken).toBe(renewal.accessToken);
      expect(logged).toHaveLength(0);
    });

    // The contrast with the margin: with no token left to fall back on, a refusal still ends it.
    it("still ends the session when the refresh is refused", async () => {
      const { request } = await nearing(-60);
      const { jar, cleared } = request();
      const { deps, logged } = depsWith(verify, authDouble(invalidGrant).auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
      expect(cleared).toStrictEqual([SESSION_COOKIE]);
      expect(logged.map((failure) => failure.status)).toStrictEqual(["ended"]);
    });

    it("is still unavailable when the provider is down", async () => {
      const { request } = await nearing(-60);
      const { jar, cleared } = request();
      const { deps } = depsWith(verify, authDouble(outage("unavailable")).auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "unavailable" });
      expect(cleared).toHaveLength(0);
    });
  });

  // The token still verifies, so a failed early refresh is never worse than not having tried: the
  // person is served the token they came with, and the session is left exactly as it was.
  describe("when the early refresh fails", () => {
    it.each([
      ["the provider is unavailable", outage("unavailable"), "unavailable"],
      ["the provider is rate limiting", outage("rate-limited"), "rate-limited"],
      // Inside the margin this is also what a request carrying a stale cookie gets once WorkOS's
      // reuse window has passed. Clearing the cookie here would sign out the winner's session.
      ["WorkOS refuses the grant", invalidGrant, "unauthorized"],
    ] as const)(
      "keeps the person signed in on the current token when %s",
      async (_, refresh, reason) => {
        const { request } = await nearing(10);
        const { jar, written, cleared } = request();
        const { auth, calls } = authDouble(refresh);
        const { deps, logged } = depsWith(verify, auth);

        expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
        expect(calls).toHaveLength(1);
        expect(written).toHaveLength(0);
        expect(cleared).toHaveLength(0);
        // Logged, with the outcome the person actually got.
        expect(logged).toStrictEqual([
          { kind: "token", reason, status: "signed-in", error: expect.any(WorkOSAuthError) },
        ]);
      },
    );

    it.each([
      ["a signature", "signature", () => forger.sign(300, { roles: ["admin"] })],
      ["a claims", "claims", () => provider.sign(300, { roles: 42 })],
    ] as const)(
      "keeps the current token, and discards the replacement, on %s failure",
      async (_, reason, replacement) => {
        const { request, renewal } = await nearing(10);
        const { jar, written, cleared } = request();
        const bad = { ...renewal, accessToken: await replacement() };
        const { deps, logged } = depsWith(verify, authDouble(() => Promise.resolve(bad)).auth);

        expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
        expect(written).toHaveLength(0);
        expect(cleared).toHaveLength(0);
        expect(logged.map((failure) => [failure.reason, failure.status])).toStrictEqual([
          [reason, "signed-in"],
        ]);
      },
    );

    // The behaviour the expired path already has: a rotation that happened is kept, so the next
    // request can verify the replacement instead of spending a refresh token that is now used.
    it("keeps a rotated replacement whose verification was unavailable", async () => {
      const { request, renewal } = await nearing(10);
      const { jar, written, cleared } = request();
      const keysDown: Verifier = (token) =>
        token === renewal.accessToken
          ? Promise.reject(new AuthError("unavailable", "keys unavailable"))
          : verify(token);
      const { deps } = depsWith(keysDown, authDouble(() => Promise.resolve(renewal)).auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
      expect(cleared).toHaveLength(0);
      expect(readSession(cookieKey, written[0]?.value)).toStrictEqual({
        accessToken: renewal.accessToken,
        refreshToken: "refresh-2",
      });
    });
  });

  describe("concurrent requests inside the margin", () => {
    // Real signatures are checked off the main thread, and may take longer than a turn. A reader
    // still verifying when the shared call settles would start a call of its own, as it should, so
    // the tests wait until every reader has verified before settling it.
    function counted(count: number): { verify: Verifier; allVerified: () => Promise<void> } {
      let done = 0;
      const verifiedAll = Promise.withResolvers<void>();
      return {
        verify: async (token) => {
          try {
            return await verify(token);
          } finally {
            done += 1;
            if (done === count) verifiedAll.resolve();
          }
        },
        // Then a full turn, as above, for the last reader to get from its verification to the call.
        allVerified: async () => {
          await verifiedAll.promise;
          await nextTurn(0);
        },
      };
    }

    it("make one provider call and each write the new pair", async () => {
      const { request, renewal } = await nearing(10);
      const pending = deferred();
      const { auth, calls } = authDouble(() => pending.promise);
      const jars = [request(), request(), request()];
      const { verify: counting, allVerified } = counted(jars.length);
      const { deps } = depsWith(counting, auth);

      const readers = jars.map(({ jar }) => readAccess(jar, deps));
      await allVerified();
      expect(calls).toHaveLength(1);
      expect(refreshesInFlight()).toBe(1);

      pending.resolve(renewal);
      expect(await Promise.all(readers)).toStrictEqual(
        Array.from({ length: 3 }, () => ({ status: "signed-in", principal: renewedPrincipal })),
      );
      expect(calls).toHaveLength(1);
      for (const { written } of jars) {
        expect(readSession(cookieKey, written[0]?.value)?.accessToken).toBe(renewal.accessToken);
      }
    });

    it("all keep the current token when the one shared call is refused", async () => {
      const { request } = await nearing(10);
      const pending = deferred();
      const { auth, calls } = authDouble(() => pending.promise);
      const jars = [request(), request()];
      const { verify: counting, allVerified } = counted(jars.length);
      const { deps } = depsWith(counting, auth);

      const readers = jars.map(({ jar }) => readAccess(jar, deps));
      await allVerified();
      expect(refreshesInFlight()).toBe(1);
      pending.reject(reused());

      expect(await Promise.all(readers)).toStrictEqual([
        { status: "signed-in", principal },
        { status: "signed-in", principal },
      ]);
      expect(calls).toHaveLength(1);
      for (const { written, cleared } of jars) {
        expect(written).toHaveLength(0);
        expect(cleared).toHaveLength(0);
      }
    });
  });

  // `exp` is read only after the signature has checked out. Before that it is whatever the holder
  // of the cookie chose to write, and neither a refresh nor a pass may follow from it.
  describe("a forged token", () => {
    it.each([10, 299])("with %s seconds left ends the session without a refresh", async (left) => {
      const forged = await forger.sign(left, { roles: ["member"] });
      const { jar, cleared } = jarWith({
        [SESSION_COOKIE]: seal(cookieKey, { accessToken: forged, refreshToken: "refresh-1" }),
      });
      const { auth, calls } = authDouble();
      const { deps, logged } = depsWith(verify, auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
      expect(calls).toHaveLength(0);
      expect(cleared).toStrictEqual([SESSION_COOKIE]);
      expect(logged.map((failure) => failure.reason)).toStrictEqual(["signature"]);
    });
  });

  describe("a token without a usable exp", () => {
    // The real verifier never lets one through: `exp` is a required claim.
    it("is refused by the real verifier as a claims failure", async () => {
      const token = await provider.sign(null);
      const { jar } = jarWith({
        [SESSION_COOKIE]: seal(cookieKey, { accessToken: token, refreshToken: "refresh-1" }),
      });
      const { auth, calls } = authDouble();
      const { deps } = depsWith(verify, auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "broken" });
      expect(calls).toHaveLength(0);
    });

    // An application's own verifier may accept one. Its verdict stands, and with no expiry to be
    // near there is nothing to refresh early: the token is served, as it was before the margin.
    it.each([
      ["no exp", unsigned({ sub: "user_01HBEQ" })],
      ["a string exp", unsigned({ exp: String(NOW + 10) })],
      ["a null exp", unsigned({ exp: null })],
      // `{"alg":"none"}`, then `not json`.
      ["a payload that is not JSON", "eyJhbGciOiJub25lIn0.bm90IGpzb24."],
      ["no JWT structure at all", "access-1"],
    ])("is served without a refresh when it has %s", async (_, accessToken) => {
      const { jar, written, cleared } = jarWith({
        [SESSION_COOKIE]: seal(cookieKey, { accessToken, refreshToken: "refresh-1" }),
      });
      const { auth, calls } = authDouble();
      const { deps, logged } = depsWith(() => Promise.resolve(principal), auth);

      expect(await readAccess(jar, deps)).toStrictEqual({ status: "signed-in", principal });
      expect(calls).toHaveLength(0);
      expect(written).toHaveLength(0);
      expect(cleared).toHaveLength(0);
      expect(logged).toHaveLength(0);
    });
  });
});
