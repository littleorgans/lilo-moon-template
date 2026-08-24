import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the route definitions are wired to the handlers, and that the composition root builds.
 *
 * The rest of the suite tests the handlers with injected dependencies, which deliberately never
 * touches `getServices`. That leaves one thing unproven: whether the routes actually call those
 * handlers, and whether the real objects can be constructed at all. A typo in the wiring, or a
 * verifier built with an option the package rejects, would pass every other test in this package.
 *
 * The request context is mocked rather than started, so no server runs and no request is faked
 * beyond what the handlers read.
 */
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
  // getServices memoises per module instance, so each test needs a fresh registry or it inherits
  // whatever configuration the previous one happened to load.
  vi.resetModules();
});

afterEach(() => {
  process.env = saved;
});

describe("route wiring", () => {
  it("the start route builds a real authorization url through the real SDK", async () => {
    const { auth } = await import("../src/server/auth.js");
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
    cookies.set("lilo_session", "sealed");
    const { auth } = await import("../src/server/auth.js");
    const response = auth.endSession(null);

    expect(response.status).toBe(302);
    expect(cookies.has("lilo_session")).toBe(false);
  });

  // Reaching the state check through the real wiring proves the callback is connected and that it
  // refuses before any network call. The mocked request carries a state no cookie matches.
  it("the callback route refuses a forged state without calling the provider", async () => {
    const { auth } = await import("../src/server/auth.js");
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
    const { auth } = await import("../src/server/auth.js");
    const response = await auth.sendEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/start", {
        method: "POST",
        body: new URLSearchParams({}),
      }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a code with no surviving address cookie on the verify route", async () => {
    const { auth } = await import("../src/server/auth.js");
    const response = await auth.verifyEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/verify", {
        method: "POST",
        body: new URLSearchParams({ code: "123456" }),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Start again");
  });
});

describe("the signed-in loader through the real composition root", () => {
  it("redirects rather than rendering when there is no session", async () => {
    const { loadSignedOrRedirect } = await import("../src/server/signed-in.js");
    // TanStack's redirect() returns a Response rather than an error, and the loader throws it.
    const thrown: unknown = await loadSignedOrRedirect().then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown instanceof Response ? thrown.status : 0).toBe(307);
  });

  // Exercises liveDeps in both shapes. With no DATABASE_URL there is no scoped runner at all;
  // with one, a pool is constructed but never connected to, because no session gets that far.
  it("builds its dependencies with and without a database", async () => {
    const { loadSignedView } = await import("../src/server/signed-in.js");
    expect(await loadSignedView()).toBeNull();

    process.env["DATABASE_URL"] = "postgres://user:pass@127.0.0.1:5432/postgres";
    vi.resetModules();
    const reloaded = await import("../src/server/signed-in.js");
    expect(await reloaded.loadSignedView()).toBeNull();
  });
});

describe("getServices", () => {
  it("constructs every package from configuration, with no database when none is set", async () => {
    const { auth } = await import("../src/server/auth.js");
    const { getDatabase } = await import("../src/server/services.js");
    const services = auth.services();

    expect(services.config.clientId).toBe(env.WORKOS_CLIENT_ID);
    expect(typeof services.auth.getAuthorizationUrl).toBe("function");
    expect(typeof services.verify).toBe("function");
    expect(getDatabase()).toBeNull();
  });

  it("builds the verifier against the derived issuer and JWKS uri", async () => {
    const { auth } = await import("../src/server/auth.js");
    const { config } = auth.services();

    expect(config.issuer).toContain(env.WORKOS_CLIENT_ID);
    expect(config.jwksUri).toContain(env.WORKOS_CLIENT_ID);
  });
});
