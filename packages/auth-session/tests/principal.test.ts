import { randomBytes } from "node:crypto";

import type { Principal } from "@lilo-moon/auth";
import { describe, expect, it } from "vitest";

import type { CookieJar } from "../src/cookies.js";
import { readPrincipal } from "../src/principal.js";
import { SESSION_COOKIE, seal } from "../src/session.js";

const key = randomBytes(32);

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: [],
};

const jarWith = (present: Readonly<Record<string, string>> = {}): CookieJar => ({
  read: (name) => present[name],
  write: () => undefined,
  clear: () => undefined,
});

const deps = { cookieKey: key, verify: () => Promise.resolve(principal) };

describe("readPrincipal", () => {
  it("returns the verified Principal for a real session", async () => {
    const jar = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "a", refreshToken: "r" }),
    });
    expect(await readPrincipal(jar, deps)).toStrictEqual(principal);
  });

  it("returns null when there is no session cookie", async () => {
    expect(await readPrincipal(jarWith(), deps)).toBeNull();
  });

  // Sealing proves we wrote the cookie. It is not what proves the provider issued the token, so a
  // cookie we did not seal must not open at all.
  it("returns null for a cookie sealed with another key", async () => {
    const jar = jarWith({
      [SESSION_COOKIE]: seal(randomBytes(32), { accessToken: "a", refreshToken: "r" }),
    });
    expect(await readPrincipal(jar, deps)).toBeNull();
  });

  it("verifies the access token from the cookie rather than trusting it", async () => {
    const seen: string[] = [];
    const jar = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "the-access-token", refreshToken: "r" }),
    });
    await readPrincipal(jar, {
      cookieKey: key,
      verify: (token) => {
        seen.push(token);
        return Promise.resolve(principal);
      },
    });
    expect(seen).toStrictEqual(["the-access-token"]);
  });

  // A rejected token is not "no session". Collapsing the two would let an expired token and a
  // forged one take the same quiet path, and the caller could no longer tell them apart.
  it("raises rather than returning null when verification fails", async () => {
    const jar = jarWith({
      [SESSION_COOKIE]: seal(key, { accessToken: "expired", refreshToken: "r" }),
    });
    await expect(
      readPrincipal(jar, { cookieKey: key, verify: () => Promise.reject(new Error("expired")) }),
    ).rejects.toThrow("expired");
  });
});
