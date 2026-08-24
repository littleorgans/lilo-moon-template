import { describe, expect, it } from "vitest";

import { loadAuthConfig } from "../src/config.js";

const complete = {
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
  WORKOS_API_KEY: "a-server-only-secret",
  WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  // Derived rather than configured, so the issuer cannot drift from the client id it belongs to.
  // Both values were checked against the provider's live discovery document.
  it("derives the issuer and JWKS URI from the client id", () => {
    const config = loadAuthConfig(complete);
    expect(config.issuer).toBe(
      "https://api.workos.com/user_management/client_01M0JSGENAGWJCN0R7JME8JWGM",
    );
    expect(config.jwksUri).toBe(
      "https://api.workos.com/sso/jwks/client_01M0JSGENAGWJCN0R7JME8JWGM",
    );
  });

  it("derives a 32 byte cookie key and never keeps the password", () => {
    const config = loadAuthConfig(complete);
    expect(config.cookieKey).toHaveLength(32);
    expect(config.cookieKey.toString("utf8")).not.toContain(complete.WORKOS_COOKIE_PASSWORD);
  });

  it("derives the same key from the same password, and a different one otherwise", () => {
    const same = loadAuthConfig(complete).cookieKey;
    expect(loadAuthConfig(complete).cookieKey.equals(same)).toBe(true);
    const changed = loadAuthConfig({ ...complete, WORKOS_COOKIE_PASSWORD: "z".repeat(32) });
    expect(changed.cookieKey.equals(same)).toBe(false);
  });

  it.each([
    ["WORKOS_CLIENT_ID"],
    ["WORKOS_API_KEY"],
    ["WORKOS_REDIRECT_URI"],
    ["WORKOS_COOKIE_PASSWORD"],
  ])("names %s when it is missing rather than failing later", (name) => {
    expect(() => loadAuthConfig({ ...complete, [name]: undefined })).toThrow(name);
  });

  it("names an empty value as missing, not as present", () => {
    expect(() => loadAuthConfig({ ...complete, WORKOS_API_KEY: "" })).toThrow("WORKOS_API_KEY");
  });

  it("lists every missing name at once instead of one per run", () => {
    expect(() =>
      loadAuthConfig({ ...complete, WORKOS_API_KEY: undefined, WORKOS_CLIENT_ID: undefined }),
    ).toThrow(/WORKOS_CLIENT_ID.*WORKOS_API_KEY/u);
  });

  // Stretching a weak password would hide the weakness behind a key that still looks like a key.
  it("refuses a cookie password shorter than 32 characters", () => {
    expect(() => loadAuthConfig({ ...complete, WORKOS_COOKIE_PASSWORD: "short" })).toThrow(
      "at least 32 characters",
    );
  });

  // A Secure cookie is silently dropped over plain http, so pinning it on would make local
  // development fail with no cookie and no error.
  it("turns Secure cookies off for an http redirect uri and on otherwise", () => {
    expect(loadAuthConfig(complete).secureCookies).toBe(false);
    expect(
      loadAuthConfig({ ...complete, WORKOS_REDIRECT_URI: "https://cubicell.dev/callback" })
        .secureCookies,
    ).toBe(true);
  });
});
