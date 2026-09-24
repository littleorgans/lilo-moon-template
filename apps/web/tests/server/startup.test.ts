import { afterEach, describe, expect, it, vi } from "vitest";

import startup, { checkConfiguration, checkStartup } from "../../src/server/startup.js";

const valid = {
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
  WORKOS_API_KEY: "sk_not_a_real_key_for_startup_only",
  WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
};

// The finding this closes: a bad cookie password passed the deploy and failed the first request.
describe("checkConfiguration", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts a complete configuration", () => {
    expect(() => {
      checkConfiguration(valid, false);
    }).not.toThrow();
  });

  it.each([
    ["a short current password", { WORKOS_COOKIE_PASSWORD: "too-short-to-be-a-key" }],
    ["a short previous password", { WORKOS_COOKIE_PASSWORD_PREVIOUS: "too-short-to-be-a-key" }],
    [
      "a previous password equal to the current",
      { WORKOS_COOKIE_PASSWORD_PREVIOUS: valid.WORKOS_COOKIE_PASSWORD },
    ],
  ])("refuses %s in production, naming the variable and not the value", (_, override) => {
    const env = { ...valid, ...override };
    const refused = (() => {
      try {
        checkConfiguration(env, false);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return null;
    })();
    expect(refused).toMatch(/WORKOS_COOKIE_PASSWORD/);
    expect(refused).not.toContain(Object.values(override)[0]);
  });

  it("leaves a missing configuration to the first auth request on the dev server", () => {
    expect(() => {
      checkConfiguration({}, true);
    }).not.toThrow();
    expect(() => {
      checkConfiguration({}, false);
    }).toThrow(/Missing required environment/);
  });

  it("validates supplied configuration in dev too", () => {
    expect(() => checkConfiguration(valid, true)).not.toThrow();
    expect(() => checkConfiguration({ WORKOS_API_KEY: "partial" }, true)).toThrow(
      /Missing required/,
    );
    expect(() => checkConfiguration({ ...valid, WORKOS_COOKIE_PASSWORD: "short" }, true)).toThrow(
      /at least 32/,
    );
  });

  // Vitest runs with DEV set, like the dev server.
  it("is the Nitro plugin, and quiet outside a production build", () => {
    for (const name of [...Object.keys(valid), "WORKOS_COOKIE_PASSWORD_PREVIOUS"]) {
      vi.stubEnv(name, undefined);
    }
    expect(startup).toBe(checkStartup);
    expect(() => {
      checkStartup();
    }).not.toThrow();
  });
});
