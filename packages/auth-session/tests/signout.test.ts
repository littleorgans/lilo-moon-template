import { randomBytes } from "node:crypto";

import { UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";

import { EMAIL_COOKIE, SESSION_COOKIE, STATE_COOKIE, seal } from "../src/session.js";
import { signOut } from "../src/signout.js";
import { jarWith } from "./support.js";

const cookieKey = randomBytes(32);
const origin = "https://app.example.test";
const request = (method = "POST", from = origin) =>
  new Request(`${origin}/api/auth/signout`, {
    method,
    headers: { origin: from },
  });
const deps = {
  cookieKey,
  returnTo: `${origin}/`,
  logoutUrl: (id: string) => `https://identity.example.test/logout?sid=${id}`,
};

describe("signOut", () => {
  it("clears every flow cookie and routes the browser through provider logout", () => {
    const { jar, cleared } = jarWith({
      [SESSION_COOKIE]: seal(cookieKey, {
        accessToken: new UnsecuredJWT({ sid: "session-1", exp: 1 }).encode(),
        refreshToken: "r",
      }),
    });
    const response = signOut({ request: request() }, jar, deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(deps.logoutUrl("session-1"));
    expect(cleared).toEqual([SESSION_COOKIE, STATE_COOKIE, EMAIL_COOKIE]);
  });

  it.each([
    undefined,
    "broken",
    seal(cookieKey, { accessToken: "not-a-token", refreshToken: "r" }),
    seal(cookieKey, { accessToken: new UnsecuredJWT({}).encode(), refreshToken: "r" }),
  ])("clears a missing or unusable local session", (value) => {
    const { jar, cleared } = jarWith(value === undefined ? {} : { [SESSION_COOKIE]: value });
    expect(signOut({ request: request() }, jar, deps).headers.get("location")).toBe(`${origin}/`);
    expect(cleared).toContain(SESSION_COOKIE);
  });

  it.each([
    ["GET", origin, 405],
    ["POST", "https://another.example.test", 403],
  ] as const)("refuses %s from %s before touching cookies", (method, from, status) => {
    const { jar, cleared } = jarWith();
    expect(signOut({ request: request(method, from) }, jar, deps).status).toBe(status);
    expect(cleared).toEqual([]);
  });
});
