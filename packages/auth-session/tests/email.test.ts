import { randomBytes } from "node:crypto";

import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth, WorkOSAuthFailure } from "@littleorgans/auth-workos";
import { describe, expect, it } from "vitest";

import { completeEmailSignIn, startEmailSignIn } from "../src/email.js";
import type { CallbackFailure } from "../src/failure.js";
import { EMAIL_COOKIE, SESSION_COOKIE, readSession } from "../src/session.js";
import { jarWith, throttleDouble } from "./support.js";

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
      getLogoutUrl: () => {
        throw new Error("unexpected logout");
      },
      getAuthorizationUrl: unavailable,
      authenticateWithCode: unavailable,
      signInWithPassword: unavailable,
      challengeMfa: unavailable,
      verifyMfa: unavailable,
    },
  };
}

const origin = "http://localhost:5199";

function formRequest(
  fields: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = { origin },
): { readonly request: Request } {
  return {
    request: new Request(`${origin}/api/auth/email`, {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { "user-agent": "vitest", ...headers },
    }),
  };
}

function logSink(): { log: (failure: CallbackFailure) => void; failures: CallbackFailure[] } {
  const failures: CallbackFailure[] = [];
  return { failures, log: (failure) => failures.push(failure) };
}

const startDeps = (
  auth: WorkOSAuth,
  log: (failure: CallbackFailure) => void,
  throttle = throttleDouble().throttle,
) => ({
  auth,
  origin: `${origin}/callback`,
  throttle,
  secureCookies: false,
  codeEntryPath: "/verify-email",
  log,
});

const verifyDeps = (
  auth: WorkOSAuth,
  log: (failure: CallbackFailure) => void,
  throttle = throttleDouble().throttle,
) => ({
  auth,
  origin: `${origin}/callback`,
  throttle,
  cookieKey: randomBytes(32),
  secureCookies: false,
  organizationPolicy: "personal" as const,
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
    expect(readSession(deps, sealed?.value)).toStrictEqual({
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

// The finding this closes: a page on another origin could make any visitor's browser send codes to
// any address, and nothing bounded how many codes or guesses one client or one address could have.
describe.each([
  ["startEmailSignIn", { email: "owner@example.com" }, {}],
  ["completeEmailSignIn", { code: "123456" }, { [EMAIL_COOKIE]: "owner@example.com" }],
] as const)("%s guards", (name, fields, cookies) => {
  const run = (
    request: { readonly request: Request },
    throttle = throttleDouble().throttle,
  ): { response: Promise<Response>; calls: Call[]; written: unknown[]; cleared: string[] } => {
    const { jar, written, cleared } = jarWith(cookies);
    const { auth, calls } = authDouble();
    const { log } = logSink();
    const response =
      name === "startEmailSignIn"
        ? startEmailSignIn(request, jar, startDeps(auth, log, throttle))
        : completeEmailSignIn(request, jar, verifyDeps(auth, log, throttle));
    return { response, calls, written, cleared };
  };

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["no Origin at all", {}],
    ["no Origin, even with same-origin fetch metadata", { "sec-fetch-site": "same-origin" }],
  ])("refuses %s with 403 before the throttle or the provider", async (_, headers) => {
    const { throttle, asked } = throttleDouble();
    const { response, calls, written, cleared } = run(formRequest(fields, headers), throttle);
    expect((await response).status).toBe(403);
    expect(asked).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(cleared).toHaveLength(0);
  });

  it("asks the throttle about the client, then the lower-cased address", async () => {
    const { throttle, asked } = throttleDouble();
    const request = formRequest(
      name === "startEmailSignIn" ? { email: "Owner@Example.com" } : fields,
    );
    const { response, calls } = run(request, throttle);
    expect((await response).status).toBe(302);
    const step = name === "startEmailSignIn" ? "email-start" : "email-verify";
    expect(asked).toStrictEqual([
      { step, by: "client" },
      { step, by: "address", address: "owner@example.com" },
    ]);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("answers a throttled attempt with 429 and never reaches the provider", async () => {
    const { throttle } = throttleDouble((key) => (key.by === "address" ? 120 : null));
    const { response, calls, written, cleared } = run(formRequest(fields), throttle);
    const refused = await response;
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("120");
    expect(calls).toHaveLength(0);
    expect(written).toHaveLength(0);
    // Mid-flow on verify, exactly as after a typo: the address survives the refusal.
    expect(cleared).toHaveLength(0);
  });
});

describe("the throttle is not asked when nothing would reach the provider", () => {
  it("skips an empty address on start and a missing code on verify", async () => {
    const { throttle, asked } = throttleDouble();
    const { auth } = authDouble();
    const { log } = logSink();
    await startEmailSignIn(
      formRequest({ email: "" }),
      jarWith().jar,
      startDeps(auth, log, throttle),
    );
    await completeEmailSignIn(
      formRequest({}),
      jarWith({ [EMAIL_COOKIE]: "owner@example.com" }).jar,
      verifyDeps(auth, log, throttle),
    );
    expect(asked).toHaveLength(0);
  });
});

// RFC 5321 caps a path at 254 octets, so nothing longer is an address a code can be sent to. It is
// refused before it becomes a throttle key, and the verify cookie is checked too, because it is
// plain text and so as long as the browser made it.
const ofLength = (length: number) => `${"a".repeat(length - "@example.com".length)}@example.com`;

describe("an address over 254 characters", () => {
  it("is refused on start and in the verify cookie before the throttle or the provider", async () => {
    const { throttle, asked } = throttleDouble();
    const { auth, calls } = authDouble();
    const { log } = logSink();
    const started = await startEmailSignIn(
      formRequest({ email: ofLength(255) }),
      jarWith().jar,
      startDeps(auth, log, throttle),
    );
    const verified = await completeEmailSignIn(
      formRequest({ code: "123456" }),
      jarWith({ [EMAIL_COOKIE]: ofLength(255) }).jar,
      verifyDeps(auth, log, throttle),
    );
    expect([started.status, verified.status]).toStrictEqual([400, 400]);
    expect(asked).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  // The limit applies to the address that is used, trimmed, not to the padding around it.
  it("lets exactly 254 characters through on both steps, padding aside", async () => {
    const { throttle, asked } = throttleDouble();
    const { auth, calls } = authDouble();
    const { log } = logSink();
    const started = await startEmailSignIn(
      formRequest({ email: `  ${ofLength(254)}  ` }),
      jarWith().jar,
      startDeps(auth, log, throttle),
    );
    const verified = await completeEmailSignIn(
      formRequest({ code: "123456" }),
      jarWith({ [EMAIL_COOKIE]: ofLength(254) }).jar,
      verifyDeps(auth, log, throttle),
    );
    expect([started.status, verified.status]).toStrictEqual([302, 302]);
    expect(asked.map((key) => key.step)).toStrictEqual([
      "email-start",
      "email-start",
      "email-verify",
      "email-verify",
    ]);
    expect(calls.map((call) => call.method)).toContain("verifyMagicAuthCode");
  });
});
