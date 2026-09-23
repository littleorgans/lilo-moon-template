import { createCipheriv, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { inspect } from "node:util";

import type { Throttle } from "@littleorgans/auth-tanstack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryThrottleOptions } from "../../src/server/throttle.js";

// Compose the real auth packages with an in-memory request cookie adapter.
// Built consumer HTTP checks cover the file-route wiring separately.
const cookies = new Map<string, string>();
const written: { name: string; value: string }[] = [];

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookies.get(name),
  setCookie: (name: string, value: string) => {
    written.push({ name, value });
    cookies.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookies.delete(name);
  },
  getRequestIP: () => "203.0.113.7",
}));

const env = {
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
  WORKOS_API_KEY: "sk_not_a_real_key_for_wiring_only",
  WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, env);
  delete process.env["DATABASE_URL"];
  cookies.clear();
  written.length = 0;
  // Reset module-scoped service instances so each test reads its own configuration.
  vi.resetModules();
});

afterEach(() => {
  process.env = saved;
  vi.doUnmock("../../src/server/throttle.js");
});

const origin = new URL(env.WORKOS_REDIRECT_URI).origin;
const refuseAll: Throttle = () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 });

describe("auth runtime wiring", () => {
  it("the start route builds a real authorization url through the real SDK", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const response = auth.startSignIn(null);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.host).toBe("api.workos.com");
    expect(location.searchParams.get("client_id")).toBe(env.WORKOS_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(env.WORKOS_REDIRECT_URI);
    expect(location.searchParams.get("provider")).toBe("GoogleOAuth");
    // The state in the url is the state that was stored, or the callback compares two unrelated
    // values. This is the assertion that catches the two halves being wired to different sources.
    expect(location.searchParams.get("state")).toBe(written[0]?.value);
  });

  it("the signout route clears the session", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const cookieName = `${auth.services().config.cookieNamespace}_lilo_session`;
    cookies.set(cookieName, "sealed");
    const response = auth.endSession({
      request: new Request(`${origin}/api/auth/signout`, { method: "POST", headers: { origin } }),
    });

    expect(response.status).toBe(303);
    expect(cookies.has(cookieName)).toBe(false);
  });

  // Reaching the state check through the real wiring proves the callback is connected and that it
  // refuses before any network call. The mocked request carries a state no cookie matches.
  it("the callback route refuses a forged state without calling the provider", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const response = await auth.completeSignIn({
      request: new Request("http://localhost:5199/callback?code=abc&state=forged"),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("did not come from here");
  });
});

describe("the email routes through the real composition root", () => {
  // Each refusal fires before any provider call, so the wiring is proven without a network.
  it("refuses an empty address on the start route", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const response = await auth.sendEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/start", {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({}),
      }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a code with no surviving address cookie on the verify route", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const response = await auth.verifyEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/verify", {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({ code: "123456" }),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Start again");
  });
});

describe("the POST guards through the real composition root", () => {
  it("takes the application's origin from the configured redirect URI", async () => {
    const { auth } = await import("../../src/server/auth.js");
    expect(auth.origin()).toBe(origin);
  });

  it("the theme handler refuses another origin and accepts its own", async () => {
    const { postTheme } = await import("../../src/server/theme.js");
    const send = async (from: string) => (await postTheme({ request: themeRequest(from) })).status;
    expect(await send("https://evil.example")).toBe(403);
    expect(await send(origin)).toBe(303);
  });

  it("hands the email routes the reference throttle, keyed by the request's address", async () => {
    const built: MemoryThrottleOptions[] = [];
    vi.doMock("../../src/server/throttle.js", () => ({
      memoryThrottle: (options: MemoryThrottleOptions) => {
        built.push(options);
        return refuseAll;
      },
    }));
    const { auth } = await import("../../src/server/auth.js");
    const response = await auth.sendEmailCode({
      request: new Request(`${origin}/api/auth/email/start`, {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({ email: "owner@example.com" }),
      }),
    });
    expect(response.status).toBe(429);
    expect(built[0]?.clientOf(new Request(origin))).toBe("203.0.113.7");
  });
});

function themeRequest(from: string): Request {
  return new Request(`${origin}/api/theme`, {
    method: "POST",
    headers: { origin: from },
    body: new URLSearchParams({ mode: "dark" }),
  });
}

describe("the signed-in loader through the real composition root", () => {
  it("redirects rather than rendering when there is no session", async () => {
    const { loadWorkspaceOrRedirect } =
      await import("../../src/features/workspace/server/load-workspace.js");
    // TanStack's redirect() returns a Response rather than an error, and the loader throws it.
    const thrown: unknown = await loadWorkspaceOrRedirect().then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown instanceof Response ? thrown.status : 0).toBe(307);
  });

  // Exercises liveDeps in both shapes. With no DATABASE_URL there is no scoped runner at all;
  // with one, a pool is constructed but never connected to, because no session gets that far. Both
  // redirect, because the mocked request carries no session cookie.
  it("builds its dependencies with and without a database", async () => {
    const { loadWorkspaceOrRedirect } =
      await import("../../src/features/workspace/server/load-workspace.js");
    await expect(loadWorkspaceOrRedirect()).rejects.toBeInstanceOf(Response);

    process.env["DATABASE_URL"] = "postgres://user:pass@127.0.0.1:5432/postgres";
    vi.resetModules();
    const reloaded = await import("../../src/features/workspace/server/load-workspace.js");
    await expect(reloaded.loadWorkspaceOrRedirect()).rejects.toBeInstanceOf(Response);
  });
});

describe("application services", () => {
  it("constructs every package from configuration, with no database when none is set", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const { getDatabase } = await import("../../src/server/database.js");
    const services = auth.services();

    expect(services.config.clientId).toBe(env.WORKOS_CLIENT_ID);
    expect(typeof services.auth.getAuthorizationUrl).toBe("function");
    expect(typeof services.verify).toBe("function");
    expect(getDatabase()).toBeNull();
  });

  it("builds the verifier against the derived issuer and JWKS uri", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const { config } = auth.services();

    expect(config.issuer).toContain(env.WORKOS_CLIENT_ID);
    expect(config.jwksUri).toContain(env.WORKOS_CLIENT_ID);
  });
});

// A key this test owns, served in place of the WorkOS JWKS, so the real verifier accepts a session
// minted here and the signed-in path runs end to end without a network.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function mint(claims: Readonly<Record<string, unknown>>): string {
  const body = `${encode({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${encode(claims)}`;
  return `${body}.${sign("sha256", Buffer.from(body), privateKey).toString("base64url")}`;
}

/**
 * The session cookie's envelope, written out because this application imports only the adapter.
 * If it drifts from `seal` in auth-session, the loader below redirects and the test fails.
 */
function sealSession(key: Buffer, session: { accessToken: string; refreshToken: string }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

describe("the access token stays on the server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // What the loader returns is serialised into the page. The token that proved the session must be
  // in neither that value nor the Principal inside it, however either is read.
  it("is absent from the signed-in loader's output and its Principal", async () => {
    const { auth } = await import("../../src/server/auth.js");
    const { loadWorkspaceOrRedirect } =
      await import("../../src/features/workspace/server/load-workspace.js");
    const { config } = auth.services();
    const token = mint({
      iss: config.issuer,
      sub: "user_01HBEQ",
      org_id: "org_01M0",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    cookies.set(
      `${config.cookieNamespace}_lilo_session`,
      sealSession(config.cookieKey, { accessToken: token, refreshToken: "r" }),
    );
    vi.stubGlobal("fetch", (input: string | URL) =>
      String(input) === config.jwksUri
        ? Promise.resolve(Response.json({ keys: [jwk] }))
        : Promise.reject(new Error(`unexpected fetch ${String(input)}`)),
    );

    const view = await loadWorkspaceOrRedirect();

    expect(view.principal.userId).toBe("user_01HBEQ");
    for (const value of [view, view.principal]) {
      expect(JSON.stringify(value)).not.toContain(token);
      expect(inspect(value, { depth: Infinity, showHidden: true })).not.toContain(token);
    }
  });
});
