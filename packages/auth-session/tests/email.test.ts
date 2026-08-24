import { randomBytes } from "node:crypto";

import { WorkOSAuthError } from "@lilo-moon/auth-workos";
import type { Authentication, WorkOSAuth, WorkOSAuthFailure } from "@lilo-moon/auth-workos";
import { describe, expect, it } from "vitest";

import { completeEmailSignIn, startEmailSignIn } from "../src/email.js";
import type { CallbackFailure } from "../src/failure.js";
import { EMAIL_COOKIE, SESSION_COOKIE, readSession } from "../src/session.js";
import { jarWith } from "./support.js";

const user = {
  id: "user_01HBEQ",
  email: "owner@example.com",
  emailVerified: true,
  profilePictureUrl: null,
  name: null,
  firstName: null,
  lastName: null,
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

function authDouble(verify: () => Promise<Authentication> = () => Promise.resolve(arrival)): {
  auth: WorkOSAuth;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    auth: {
      sendMagicAuthCode(options) {
        calls.push({ method: "sendMagicAuthCode", options });
        return Promise.resolve({
          id: "magic_01",
          userId: user.id,
          email: user.email,
          expiresAt: "2026-08-25T00:10:00.000Z",
        });
      },
      verifyMagicAuthCode(options) {
        calls.push({ method: "verifyMagicAuthCode", options });
        return verify();
      },
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
      challengeMfa: unavailable,
      verifyMfa: unavailable,
    },
  };
}

function formRequest(fields: Readonly<Record<string, string>>): { readonly request: Request } {
  return {
    request: new Request("http://localhost:5199/api/auth/email", {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { "user-agent": "vitest" },
    }),
  };
}

function logSink(): { log: (failure: CallbackFailure) => void; failures: CallbackFailure[] } {
  const failures: CallbackFailure[] = [];
  return { failures, log: (failure) => failures.push(failure) };
}

const startDeps = (auth: WorkOSAuth, log: (failure: CallbackFailure) => void) => ({
  auth,
  secureCookies: false,
  codeEntryPath: "/verify-email",
  log,
});

const verifyDeps = (auth: WorkOSAuth, log: (failure: CallbackFailure) => void) => ({
  auth,
  cookieKey: randomBytes(32),
  secureCookies: false,
  signedInPath: "/app",
  codeEntryPath: "/verify-email",
  log,
});

describe("startEmailSignIn", () => {
  it("sends the code, remembers the address, and moves to code entry", async () => {
    const { jar, written } = jarWith();
    const { auth, calls } = authDouble();
    const { log } = logSink();

    const response = await startEmailSignIn(
      formRequest({ email: "  owner@example.com " }),
      jar,
      startDeps(auth, log),
    );

    expect(calls).toStrictEqual([
      { method: "sendMagicAuthCode", options: { email: "owner@example.com", userAgent: "vitest" } },
    ]);
    expect(written).toHaveLength(1);
    expect(written[0]?.name).toBe(EMAIL_COOKIE);
    expect(written[0]?.value).toBe("owner@example.com");
    expect(written[0]?.options.httpOnly).toBe(true);
    expect(written[0]?.options.maxAge).toBe(600);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/verify-email");
  });

  it("refuses an empty address before calling the provider", async () => {
    const { jar, written } = jarWith();
    const { auth, calls } = authDouble();
    const { log } = logSink();

    const response = await startEmailSignIn(
      formRequest({ email: "   " }),
      jar,
      startDeps(auth, log),
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  it("collapses a provider failure and stores no address for it", async () => {
    const { jar, written } = jarWith();
    const { auth } = authDouble();
    const failing: WorkOSAuth = {
      ...auth,
      sendMagicAuthCode: () =>
        Promise.reject(
          new WorkOSAuthError({ reason: "rate-limited", message: "slow down", cause: null }),
        ),
    };
    const { log, failures } = logSink();

    const response = await startEmailSignIn(
      formRequest({ email: "owner@example.com" }),
      jar,
      startDeps(failing, log),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("temporarily unavailable");
    expect(failures.map((failure) => failure.reason)).toStrictEqual(["rate-limited"]);
    expect(written).toHaveLength(0);
  });
});

describe("completeEmailSignIn", () => {
  it("verifies the code, provisions the organization, and seals the session", async () => {
    const { jar, written, cleared } = jarWith({ [EMAIL_COOKIE]: "owner@example.com" });
    const { auth, calls } = authDouble();
    const { log } = logSink();
    const deps = verifyDeps(auth, log);

    const response = await completeEmailSignIn(formRequest({ code: "123456" }), jar, deps);

    expect(calls.map((call) => call.method)).toStrictEqual([
      "verifyMagicAuthCode",
      "provisionOrganization",
      "refreshTokens",
    ]);
    expect(calls[0]?.options).toStrictEqual({
      email: "owner@example.com",
      code: "123456",
      userAgent: "vitest",
    });
    const sealed = written.find((entry) => entry.name === SESSION_COOKIE);
    expect(sealed).toBeDefined();
    expect(readSession(deps.cookieKey, sealed?.value)).toStrictEqual({
      accessToken: "access-with-org",
      refreshToken: "refresh-2",
    });
    expect(cleared).toContain(EMAIL_COOKIE);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app");
  });

  it("skips provisioning for a person who already has an organization", async () => {
    const { jar } = jarWith({ [EMAIL_COOKIE]: "owner@example.com" });
    const { auth, calls } = authDouble(() =>
      Promise.resolve({ ...arrival, organizationId: "org_01M0" }),
    );
    const { log } = logSink();

    const response = await completeEmailSignIn(
      formRequest({ code: "123456" }),
      jar,
      verifyDeps(auth, log),
    );

    expect(calls.map((call) => call.method)).toStrictEqual(["verifyMagicAuthCode"]);
    expect(response.status).toBe(302);
  });

  it("expires cleanly when no address cookie survives", async () => {
    const { jar } = jarWith();
    const { auth, calls } = authDouble();
    const { log } = logSink();

    const response = await completeEmailSignIn(
      formRequest({ code: "123456" }),
      jar,
      verifyDeps(auth, log),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Start again");
    expect(calls).toHaveLength(0);
  });

  it("returns a rejected code to the entry page and keeps the address", async () => {
    const { jar, cleared } = jarWith({ [EMAIL_COOKIE]: "owner@example.com" });
    const { auth } = authDouble(() =>
      Promise.reject(
        new WorkOSAuthError({ reason: "code-rejected", message: "wrong code", cause: null }),
      ),
    );
    const { log, failures } = logSink();

    const response = await completeEmailSignIn(
      formRequest({ code: "000000" }),
      jar,
      verifyDeps(auth, log),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/verify-email?retry=true");
    expect(cleared).toHaveLength(0);
    expect(failures.map((failure) => failure.reason)).toStrictEqual(["code-rejected"]);
  });

  it("treats a missing code as rejected without calling the provider", async () => {
    const { jar } = jarWith({ [EMAIL_COOKIE]: "owner@example.com" });
    const { auth, calls } = authDouble();
    const { log } = logSink();

    const response = await completeEmailSignIn(formRequest({}), jar, verifyDeps(auth, log));

    expect(response.headers.get("location")).toBe("/verify-email?retry=true");
    expect(calls).toHaveLength(0);
  });

  it.each(["unavailable", "sso-required", "invalid-request"] satisfies WorkOSAuthFailure[])(
    "collapses a %s failure exactly as the callback does",
    async (reason) => {
      const { jar, cleared } = jarWith({ [EMAIL_COOKIE]: "owner@example.com" });
      const { auth } = authDouble(() =>
        Promise.reject(new WorkOSAuthError({ reason, message: reason, cause: null })),
      );
      const { log, failures } = logSink();

      const response = await completeEmailSignIn(
        formRequest({ code: "123456" }),
        jar,
        verifyDeps(auth, log),
      );

      expect(response.status).toBe(400);
      expect(cleared).toHaveLength(0);
      expect(failures.map((failure) => failure.reason)).toStrictEqual([reason]);
    },
  );
});
