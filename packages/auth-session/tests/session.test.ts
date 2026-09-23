import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { newState, readSession, seal, stateMatches, unseal } from "../src/session.js";

const key = randomBytes(32);
const other = randomBytes(32);
const session = { accessToken: "access-token", refreshToken: "refresh-token" };

describe("seal and unseal", () => {
  it("round-trips a value", () => {
    expect(unseal(key, seal(key, session))).toStrictEqual(session);
  });

  // Without a per-seal IV, two identical sessions produce identical cookies, which leaks that two
  // requests carry the same session to anyone who can see both.
  it("produces a different ciphertext each time for the same input", () => {
    expect(seal(key, session)).not.toBe(seal(key, session));
  });

  it("refuses a cookie sealed with a different key", () => {
    expect(unseal(other, seal(key, session))).toBeNull();
  });

  // The point of GCM. A cookie whose body was edited must fail authentication rather than decrypt
  // to something else, or the browser could choose its own access token.
  it("refuses a cookie whose ciphertext was altered", () => {
    const raw = Buffer.from(seal(key, session), "base64url");
    const last = raw.length - 1;
    raw.writeUInt8(raw.readUInt8(last) ^ 0xff, last);
    expect(unseal(key, raw.toString("base64url"))).toBeNull();
  });

  it("refuses a cookie whose authentication tag was altered", () => {
    // Byte 13 is inside the 16 byte authentication tag, which begins right after the 12 byte IV.
    const raw = Buffer.from(seal(key, session), "base64url");
    raw.writeUInt8(raw.readUInt8(13) ^ 0xff, 13);
    expect(unseal(key, raw.toString("base64url"))).toBeNull();
  });

  it.each([["not-base64url-at-all!!"], [""], ["c2hvcnQ"]])(
    "returns null rather than throwing for %o",
    (value) => {
      expect(unseal(key, value)).toBeNull();
    },
  );
});

describe("readSession", () => {
  it("reads a sealed session back", () => {
    expect(readSession({ cookieKey: key }, seal(key, session))).toStrictEqual(session);
  });

  it("returns null when there is no cookie at all", () => {
    expect(readSession({ cookieKey: key }, undefined)).toBeNull();
  });

  // A sealed value we minted is still not automatically a session. Shape is checked after opening,
  // because an older cookie format would otherwise arrive as a half-populated object.
  it.each([
    ["missing refreshToken", { accessToken: "a" }],
    ["missing accessToken", { refreshToken: "r" }],
    ["empty accessToken", { accessToken: "", refreshToken: "r" }],
    ["wrong types", { accessToken: 1, refreshToken: 2 }],
    ["not an object", "just a string"],
  ])("returns null for a sealed value with %s", (_name, value) => {
    expect(readSession({ cookieKey: key }, seal(key, value))).toBeNull();
  });

  // Every listed key opens, so a rotation signs nobody out, and a cookie no key opens is null
  // exactly as a tampered one is.
  it("opens a cookie sealed with the current key or any previous key, and no other", () => {
    const third = randomBytes(32);
    const keys = { cookieKey: key, previousCookieKeys: [other, third] };
    for (const sealedWith of [key, other, third]) {
      expect(readSession(keys, seal(sealedWith, session))).toStrictEqual(session);
    }
    expect(readSession(keys, seal(randomBytes(32), session))).toBeNull();
    expect(readSession({ cookieKey: key }, seal(other, session))).toBeNull();
  });
});

describe("newState", () => {
  it("is unguessable enough to be a CSRF token", () => {
    const values = new Set(Array.from({ length: 200 }, () => newState()));
    expect(values.size).toBe(200);
    expect(newState().length).toBeGreaterThanOrEqual(43);
  });
});

describe("stateMatches", () => {
  it("accepts the value we issued", () => {
    const state = newState();
    expect(stateMatches(state, state)).toBe(true);
  });

  it.each([
    ["a different value", "issued-state", "attacker-state"],
    ["a prefix", "issued-state", "issued"],
    ["a longer value", "issued-state", "issued-state-plus"],
  ])("rejects %s", (_name, expected, returned) => {
    expect(stateMatches(expected, returned)).toBe(false);
  });

  // The two cases that matter most: no cookie means the flow did not start here, and no returned
  // state means the provider was not given one. Neither may be treated as a match.
  it("rejects when no state was issued", () => {
    expect(stateMatches(undefined, "anything")).toBe(false);
  });

  it("rejects when nothing came back", () => {
    expect(stateMatches("issued-state", null)).toBe(false);
  });

  it("rejects two absent values rather than calling them equal", () => {
    expect(stateMatches(undefined, null)).toBe(false);
  });
});

it("writes only the token pair even when given a richer authentication result", async () => {
  const { writeSession } = await import("../src/session.js");
  const { jarWith } = await import("./support.js");
  const { jar, written } = jarWith();
  const result = {
    ...session,
    user: { email: "private@example.test" },
    organizationId: "org-test",
  };
  writeSession(jar, { cookieKey: key, secureCookies: false }, result);
  expect(unseal(key, written[0]?.value ?? "")).toEqual(session);
});

// The one rule rotation rests on. A cookie sealed with a previous key would be unreadable the moment
// that key is removed, so writing one would make removing it sign people out.
it("seals with the current key and never a previous one", async () => {
  const { writeSession } = await import("../src/session.js");
  const { jarWith } = await import("./support.js");
  const { jar, written } = jarWith();
  writeSession(jar, { cookieKey: key, previousCookieKeys: [other], secureCookies: false }, session);
  expect(unseal(key, written[0]?.value ?? "")).toEqual(session);
  expect(unseal(other, written[0]?.value ?? "")).toBeNull();
});
