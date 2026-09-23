import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import type {
  AuthFailureReport,
  CookieJar,
  CookieOptions,
  ServiceOrigin,
  Throttle,
  ThrottleKey,
} from "@littleorgans/auth-session";
import {
  EMAIL_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  loadAuthConfig,
  seal,
} from "@littleorgans/auth-session";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthRuntime } from "../../src/runtime.js";

const env = {
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
  WORKOS_API_KEY: "a-server-only-secret",
  WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
};

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

const origin = "http://localhost:5199";
const signout = {
  request: new Request(`${origin}/api/auth/signout`, { method: "POST", headers: { origin } }),
};

const allowAll: Throttle = () => Promise.resolve({ allowed: true });

const runtimeWith = (
  jar: CookieJar,
  provider: "GoogleOAuth" | "authkit" = "GoogleOAuth",
  throttle = allowAll,
) =>
  createAuthRuntime({
    provider,
    signedInPath: "/app",
    organizationPolicy: "personal",
    codeEntryPath: "/verify-email",
    throttle,
    env,
    cookies: jar,
  });

describe("createAuthRuntime", () => {
  // Reading the environment at construction would make importing any route in a test depend on a
  // filled .env.local. Nothing is read until something is asked for.
  it("reads no configuration until it is used", () => {
    expect(() =>
      createAuthRuntime({
        provider: "GoogleOAuth",
        signedInPath: "/app",
        organizationPolicy: "personal",
        codeEntryPath: "/verify-email",
        throttle: allowAll,
        env: {},
      }),
    ).not.toThrow();
  });

  it("reports the missing configuration on first use, not at import", () => {
    const runtime = createAuthRuntime({
      provider: "GoogleOAuth",
      signedInPath: "/app",
      organizationPolicy: "personal",
      codeEntryPath: "/verify-email",
      throttle: allowAll,
      env: {},
    });
    expect(() => runtime.services()).toThrow("WORKOS_CLIENT_ID");
  });

  it("builds the services once and holds them", () => {
    const runtime = runtimeWith(jarWith().jar);
    expect(runtime.services()).toBe(runtime.services());
  });
});

describe("startSignIn", () => {
  it("redirects to the provider and stores the state it sent", () => {
    const { jar, written } = jarWith();
    const response = runtimeWith(jar).startSignIn(null);

    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location") ?? "");
    expect(url.host).toBe("api.workos.com");
    expect(url.searchParams.get("state")).toBe(written[0]?.value);
    expect(written[0]?.name).toMatch(new RegExp(`^[a-f0-9]{16}_${STATE_COOKIE}$`));
  });

  // The provider is the application's choice. Hardcoding it would mean a product that wants the
  // hosted sign-in page has to rewrite this package.
  it("sends the provider the application chose", () => {
    const { jar } = jarWith();
    const url = new URL(
      runtimeWith(jar, "authkit").startSignIn(null).headers.get("location") ?? "",
    );
    expect(url.searchParams.get("provider")).toBe("authkit");
  });

  it("uses the redirect uri from configuration rather than inventing one", () => {
    const { jar } = jarWith();
    const url = new URL(runtimeWith(jar).startSignIn(null).headers.get("location") ?? "");
    expect(url.searchParams.get("redirect_uri")).toBe(env.WORKOS_REDIRECT_URI);
  });
});

describe("completeSignIn", () => {
  // Reached through the runtime rather than the handler, so this proves the runtime supplies the
  // jar and the key. A forged state must stop here, before any provider call.
  it("refuses a forged state", async () => {
    const present: Record<string, string> = {};
    const { jar, written } = jarWith(present);
    const runtime = runtimeWith(jar);
    runtime.startSignIn(null);
    const state = written[0];
    if (state === undefined) throw new Error("No state cookie was written");
    present[state.name] = state.value;
    const response = await runtime.completeSignIn({
      request: new Request("http://localhost:5199/callback?code=c&state=forged"),
    });
    expect(response.status).toBe(400);
  });
});

describe("the email handlers through the runtime", () => {
  // Each refusal fires before any provider call, so the wiring is proven without a network. The
  // handler order itself is @littleorgans/auth-session's to prove.
  it("sendEmailCode refuses an empty form through the real services", async () => {
    const { jar } = jarWith();
    const response = await runtimeWith(jar).sendEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/start", {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({}),
      }),
    });
    expect(response.status).toBe(400);
  });

  it("verifyEmailCode refuses when no address cookie survives", async () => {
    const { jar } = jarWith();
    const response = await runtimeWith(jar).verifyEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/verify", {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({ code: "123456" }),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Start again");
  });

  // Proves the runtime hands the handlers the configured origin: another origin stops at 403.
  it("both email handlers refuse another origin", async () => {
    const runtime = runtimeWith(jarWith().jar);
    const responses = await Promise.all(
      [runtime.sendEmailCode, runtime.verifyEmailCode].map((handler) =>
        handler({
          request: new Request(`${origin}/api/auth/email`, {
            method: "POST",
            headers: { origin: "https://evil.example" },
            body: new URLSearchParams({ email: "owner@example.com", code: "123456" }),
          }),
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toStrictEqual([403, 403]);
  });

  // Proves the runtime hands the handlers the application's throttle. A refusal answers before the
  // provider, so no network is needed.
  it("both email handlers ask the application's throttle", async () => {
    const asked: ThrottleKey[] = [];
    const refuseAll: Throttle = (key) => {
      asked.push(key);
      return Promise.resolve({ allowed: false, retryAfterSeconds: 60 });
    };
    const present: Record<string, string> = {};
    const runtime = runtimeWith(jarWith(present).jar, "GoogleOAuth", refuseAll);
    present[`${runtime.services().config.cookieNamespace}_${EMAIL_COOKIE}`] = "owner@example.com";
    const post = () =>
      new Request(`${origin}/api/auth/email`, {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({ email: "owner@example.com", code: "123456" }),
      });
    const statuses = [
      (await runtime.sendEmailCode({ request: post() })).status,
      (await runtime.verifyEmailCode({ request: post() })).status,
    ];
    expect(statuses).toStrictEqual([429, 429]);
    expect(asked.map((key) => key.step)).toStrictEqual(["email-start", "email-verify"]);
  });
});

describe("origin", () => {
  it("is the configured redirect URI's origin", () => {
    expect(runtimeWith(jarWith().jar).origin()).toBe(origin);
  });
});

describe("endSession", () => {
  it("clears the session and returns to the sign-in page", () => {
    const { jar, cleared } = jarWith();
    const response = runtimeWith(jar).endSession(signout);

    expect(cleared.map((name) => name.slice(17))).toStrictEqual([
      SESSION_COOKIE,
      STATE_COOKIE,
      EMAIL_COOKIE,
    ]);
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });
});

describe("access", () => {
  it("is anonymous when there is no session", async () => {
    expect(await runtimeWith(jarWith().jar).access()).toStrictEqual({ status: "anonymous" });
  });

  // The runtime must hand the verifier the key derived from this configuration. A cookie sealed
  // with any other key does not open, so it is not a session rather than a rejected one.
  it("is anonymous for a cookie sealed with another key", async () => {
    const present: Record<string, string> = {};
    const { jar } = jarWith(present);
    const runtime = runtimeWith(jar);
    present[`${runtime.services().config.cookieNamespace}_${SESSION_COOKIE}`] = seal(
      randomBytes(32),
      { accessToken: "a", refreshToken: "r" },
    );
    expect(await runtime.access()).toStrictEqual({ status: "anonymous" });
  });

  // Reached through the runtime rather than the reader, so this proves the runtime supplies the
  // verifier, the key and the log sink. "not.a.jwt" cannot be parsed, let alone verified.
  it("ends a session whose token is not a token, and clears the cookie", async () => {
    const reports: AuthFailureReport[] = [];
    const present: Record<string, string> = {};
    const { jar, cleared } = jarWith(present);
    const runtime = createAuthRuntime({
      provider: "GoogleOAuth",
      signedInPath: "/app",
      organizationPolicy: "personal",
      codeEntryPath: "/verify-email",
      throttle: allowAll,
      env,
      cookies: jar,
      log: (failure) => reports.push(failure),
    });
    // Sealed with the runtime's own derived key, so the cookie opens and the token inside is what
    // fails. Sealing with any other key would prove nothing but that the key is wrong.
    present[`${runtime.services().config.cookieNamespace}_${SESSION_COOKIE}`] = seal(
      runtime.services().config.cookieKey,
      {
        accessToken: "not.a.jwt",
        refreshToken: "r",
      },
    );

    expect(await runtime.access()).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([
      `${runtime.services().config.cookieNamespace}_${SESSION_COOKIE}`,
    ]);
    expect(reports.map((report) => report.reason)).toStrictEqual(["malformed"]);
  });
});

// The runtime must hand every reader of the session the previous keys, not only the current one. A
// cookie sealed before the rotation opens, so its unparseable token ends the session rather than
// leaving it anonymous, and sign-out finds the provider session inside it.
describe("a rotated cookie password", () => {
  const rotated = {
    ...env,
    WORKOS_COOKIE_PASSWORD: "n".repeat(32),
    WORKOS_COOKIE_PASSWORD_PREVIOUS: env.WORKOS_COOKIE_PASSWORD,
  };
  const before = loadAuthConfig(env);

  function holding(accessToken: string) {
    const present: Record<string, string> = {};
    const runtime = createAuthRuntime({
      provider: "GoogleOAuth",
      signedInPath: "/app",
      organizationPolicy: "personal",
      codeEntryPath: "/verify-email",
      throttle: allowAll,
      env: rotated,
      cookies: jarWith(present).jar,
      log: () => undefined,
    });
    present[`${before.cookieNamespace}_${SESSION_COOKIE}`] = seal(before.cookieKey, {
      accessToken,
      refreshToken: "r",
    });
    return runtime;
  }

  it("opens a cookie sealed before the rotation in access and asUser", async () => {
    expect(await holding("not.a.jwt").access()).toStrictEqual({ status: "ended" });
    expect(await holding("not.a.jwt").asUser()).toStrictEqual({ status: "ended" });
  });

  it("ends the provider session named in a cookie sealed before the rotation", () => {
    const token = `${encode({ alg: "none" })}.${encode({ sid: "session_01" })}.`;
    const location = holding(token).endSession(signout).headers.get("location");
    expect(location).toContain("session_id=session_01");
  });
});

// The real verifier, fed a key this test owns: the JWKS endpoint is answered in place of WorkOS,
// so a token minted here verifies exactly as a provider-issued one would, without a network.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function mint(claims: Readonly<Record<string, unknown>>): string {
  const body = `${encode({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${encode(claims)}`;
  return `${body}.${sign("sha256", Buffer.from(body), privateKey).toString("base64url")}`;
}

const service = "https://api.example.com";

describe("asUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A runtime holding a session whose token the real verifier accepts, and what reached the wire. */
  function signedInRuntime(serviceOrigins?: readonly ServiceOrigin[]) {
    const present: Record<string, string> = {};
    const runtime = createAuthRuntime({
      provider: "GoogleOAuth",
      signedInPath: "/app",
      organizationPolicy: "personal",
      codeEntryPath: "/verify-email",
      throttle: allowAll,
      env,
      cookies: jarWith(present).jar,
      ...(serviceOrigins === undefined ? {} : { serviceOrigins }),
    });
    const { config } = runtime.services();
    const token = mint({
      iss: config.issuer,
      sub: "user_01HBEQ",
      org_id: "org_01M0",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    present[`${config.cookieNamespace}_${SESSION_COOKIE}`] = seal(config.cookieKey, {
      accessToken: token,
      refreshToken: "r",
    });
    const sent: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === config.jwksUri) return Promise.resolve(Response.json({ keys: [jwk] }));
      sent.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return Promise.resolve(new Response("ok"));
    });
    return { runtime, token, sent };
  }

  // Proves the runtime hands the reader the configured origins, the verifier and the key: the
  // token that proved the session is the one the service receives.
  it("calls a configured service with the verified token as the bearer", async () => {
    const { runtime, token, sent } = signedInRuntime([service]);
    const user = await runtime.asUser();
    if (user.status !== "signed-in") throw new Error(`Expected signed-in, got ${user.status}`);

    expect(user.principal.userId).toBe("user_01HBEQ");
    expect(await (await user.fetch(`${service}/v1/me`)).text()).toBe("ok");
    expect(sent).toStrictEqual([{ url: `${service}/v1/me`, authorization: `Bearer ${token}` }]);
    expect(JSON.stringify(user)).not.toContain(token);
  });

  it("calls a plain http service only when its origin is marked insecure", async () => {
    const inCluster = "http://api:3000";
    const { runtime, token, sent } = signedInRuntime([
      service,
      { origin: inCluster, insecure: true },
    ]);
    const user = await runtime.asUser();
    if (user.status !== "signed-in") throw new Error(`Expected signed-in, got ${user.status}`);

    await user.fetch(`${inCluster}/v1/account`);
    await expect(user.fetch("http://api.example.com/v1/me")).rejects.toThrow(
      "not in serviceOrigins",
    );
    expect(sent).toStrictEqual([
      { url: `${inCluster}/v1/account`, authorization: `Bearer ${token}` },
    ]);
  });

  it("sends the token nowhere when the application configured no services", async () => {
    const { runtime, sent } = signedInRuntime();
    const user = await runtime.asUser();
    if (user.status !== "signed-in") throw new Error(`Expected signed-in, got ${user.status}`);

    await expect(user.fetch(`${service}/v1/me`)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });

  it("maps a missing and a rejected session onto the same states as access", async () => {
    const present: Record<string, string> = {};
    const runtime = runtimeWith(jarWith(present).jar);
    expect(await runtime.asUser()).toStrictEqual({ status: "anonymous" });

    const { config } = runtime.services();
    present[`${config.cookieNamespace}_${SESSION_COOKIE}`] = seal(config.cookieKey, {
      accessToken: "not.a.jwt",
      refreshToken: "r",
    });
    expect(await runtime.asUser()).toStrictEqual({ status: "ended" });
  });
});
