import { randomBytes } from "node:crypto";

import { AuthError } from "@lilo-moon/auth";
import type { Principal, Verifier } from "@lilo-moon/auth";
import type { Authentication, WorkOSAuth } from "@lilo-moon/auth-workos";
import { describe, expect, it } from "vitest";

import { readAccess } from "../src/access.js";
import type { AccessDeps } from "../src/access.js";
import type { TokenFailure } from "../src/failure.js";
import { SESSION_COOKIE, readSession, seal } from "../src/session.js";
import { jarWith } from "./support.js";

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
    const { auth } = authDouble(() => Promise.reject(new Error("refresh token revoked")));
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
    const { deps, logged } = depsWith(rejects("signature"), authDouble().auth);

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(written).toHaveLength(0);
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["signature"]);
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
  it("treats an unrecognised throw as malformed", async () => {
    const { jar } = jarWith({ [SESSION_COOKIE]: sealed("access-1") });
    const { deps, logged } = depsWith(
      () => Promise.reject(new Error("socket closed")),
      authDouble().auth,
    );

    expect(await readAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["malformed"]);
  });
});
