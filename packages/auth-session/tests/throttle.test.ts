import { describe, expect, it } from "vitest";

import { throttled } from "../src/throttle.js";
import type { ThrottleKey } from "../src/throttle.js";
import { throttleDouble } from "./support.js";

const request = new Request("https://app.example.test/api/auth/email/start", { method: "POST" });
const keys: readonly ThrottleKey[] = [
  { step: "email-start", by: "client" },
  { step: "email-start", by: "address", address: "owner@example.com" },
];

describe("throttled", () => {
  it("asks about every key and lets the request through when all allow", async () => {
    const { throttle, asked } = throttleDouble();
    expect(await throttled(throttle, request, keys)).toBeNull();
    expect(asked).toStrictEqual(keys);
  });

  it("answers a refusal with 429 and the wait, in whole seconds rounded up", async () => {
    const { throttle } = throttleDouble((key) => (key.by === "address" ? 90.2 : null));
    const response = await throttled(throttle, request, keys);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("91");
    expect(response?.headers.get("content-type")).toContain("text/html");
    expect(await response?.text()).toContain("Too many attempts");
  });

  // Retry-After 0 reads as "now", which is not what a refusal means.
  it("never tells a refused client to retry immediately", async () => {
    const { throttle } = throttleDouble(() => 0);
    expect((await throttled(throttle, request, keys))?.headers.get("retry-after")).toBe("1");
  });

  // A client already over its budget must not also spend the address's, or it could exhaust
  // someone else's address budget while being refused.
  it("stops at the first refusal", async () => {
    const { throttle, asked } = throttleDouble((key) => (key.by === "client" ? 30 : null));
    expect((await throttled(throttle, request, keys))?.status).toBe(429);
    expect(asked).toStrictEqual([keys[0]]);
  });
});
