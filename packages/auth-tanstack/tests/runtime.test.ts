import { randomBytes } from "node:crypto";

import type { AuthFailureReport, CookieJar, CookieOptions } from "@lilo-moon/auth-session";
import { SESSION_COOKIE, STATE_COOKIE, seal } from "@lilo-moon/auth-session";
import { describe, expect, it } from "vitest";

import { createAuthRuntime } from "../src/runtime.js";

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

const runtimeWith = (jar: CookieJar, provider: "GoogleOAuth" | "authkit" = "GoogleOAuth") =>
  createAuthRuntime({
    provider,
    signedInPath: "/app",
    codeEntryPath: "/verify-email",
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
        codeEntryPath: "/verify-email",
        env: {},
      }),
    ).not.toThrow();
  });

  it("reports the missing configuration on first use, not at import", () => {
    const runtime = createAuthRuntime({
      provider: "GoogleOAuth",
      signedInPath: "/app",
      codeEntryPath: "/verify-email",
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
    expect(written[0]?.name).toBe(STATE_COOKIE);
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
    const { jar } = jarWith({ [STATE_COOKIE]: "issued" });
    const response = await runtimeWith(jar).completeSignIn({
      request: new Request("http://localhost:5199/callback?code=c&state=forged"),
    });
    expect(response.status).toBe(400);
  });
});

describe("the email handlers through the runtime", () => {
  // Each refusal fires before any provider call, so the wiring is proven without a network. The
  // handler order itself is @lilo-moon/auth-session's to prove.
  it("sendEmailCode refuses an empty form through the real services", async () => {
    const { jar } = jarWith();
    const response = await runtimeWith(jar).sendEmailCode({
      request: new Request("http://localhost:5199/api/auth/email/start", {
        method: "POST",
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
        body: new URLSearchParams({ code: "123456" }),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Start again");
  });
});

describe("endSession", () => {
  it("clears the session and returns to the sign-in page", () => {
    const { jar, cleared } = jarWith();
    const response = runtimeWith(jar).endSession(null);

    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(response.headers.get("location")).toBe("/");
  });
});

describe("access", () => {
  it("is anonymous when there is no session", async () => {
    expect(await runtimeWith(jarWith().jar).access()).toStrictEqual({ status: "anonymous" });
  });

  // The runtime must hand the verifier the key derived from this configuration. A cookie sealed
  // with any other key does not open, so it is not a session rather than a rejected one.
  it("is anonymous for a cookie sealed with another key", async () => {
    const { jar } = jarWith({
      [SESSION_COOKIE]: seal(randomBytes(32), { accessToken: "a", refreshToken: "r" }),
    });
    expect(await runtimeWith(jar).access()).toStrictEqual({ status: "anonymous" });
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
      codeEntryPath: "/verify-email",
      env,
      cookies: jar,
      log: (failure) => reports.push(failure),
    });
    // Sealed with the runtime's own derived key, so the cookie opens and the token inside is what
    // fails. Sealing with any other key would prove nothing but that the key is wrong.
    present[SESSION_COOKIE] = seal(runtime.services().config.cookieKey, {
      accessToken: "not.a.jwt",
      refreshToken: "r",
    });

    expect(await runtime.access()).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(reports.map((report) => report.reason)).toStrictEqual(["malformed"]);
  });
});
