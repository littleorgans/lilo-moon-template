import type { ThrottleKey } from "@littleorgans/auth-tanstack";
import { describe, expect, it, vi } from "vitest";

import { EMAIL_LIMITS, memoryThrottle } from "../../src/server/throttle.js";

const request = new Request("http://localhost:5199/api/auth/email/start", { method: "POST" });
const client = { step: "email-start", by: "client" } as const satisfies ThrottleKey;
const address = (who: string) =>
  ({ step: "email-start", by: "address", address: who }) as const satisfies ThrottleKey;

function clock(start = 0): { now: () => number; advance: (seconds: number) => void } {
  let at = start;
  return {
    now: () => at,
    advance: (seconds) => {
      at += seconds * 1000;
    },
  };
}

const limits = {
  "email-start": {
    client: { attempts: 2, windowSeconds: 60 },
    address: { attempts: 1, windowSeconds: 60 },
  },
  "email-verify": {
    client: { attempts: 2, windowSeconds: 60 },
    address: { attempts: 1, windowSeconds: 60 },
  },
};

// The counter updates synchronously on each call, so starting them together still counts in order.
function attempts(throttle: ReturnType<typeof memoryThrottle>, key: ThrottleKey, times: number) {
  return Promise.all(Array.from({ length: times }, () => throttle(key, request)));
}

describe("memoryThrottle", () => {
  it("allows a key its budget, then refuses until the window reopens", async () => {
    const time = clock();
    const throttle = memoryThrottle({ clientOf: () => "198.51.100.1", limits, now: time.now });

    expect((await attempts(throttle, client, 3)).map((d) => d.allowed)).toStrictEqual([
      true,
      true,
      false,
    ]);
    time.advance(15);
    expect(await throttle(client, request)).toStrictEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
    time.advance(45);
    expect((await throttle(client, request)).allowed).toBe(true);
  });

  it("keeps one budget per client, per address and per step", async () => {
    let who = "198.51.100.1";
    const throttle = memoryThrottle({ clientOf: () => who, limits, now: clock().now });

    await attempts(throttle, client, 2);
    expect((await throttle(client, request)).allowed).toBe(false);
    who = "198.51.100.2";
    expect((await throttle(client, request)).allowed).toBe(true);

    expect((await throttle(address("a@example.com"), request)).allowed).toBe(true);
    expect((await throttle(address("a@example.com"), request)).allowed).toBe(false);
    expect((await throttle(address("b@example.com"), request)).allowed).toBe(true);
    expect(
      (await throttle({ step: "email-verify", by: "address", address: "a@example.com" }, request))
        .allowed,
    ).toBe(true);
  });

  // Without a socket address every such request shares one budget: stricter, never looser.
  it("puts clients it cannot identify in one shared budget", async () => {
    const throttle = memoryThrottle({ clientOf: () => undefined, limits, now: clock().now });
    await attempts(throttle, client, 2);
    expect((await throttle(client, request)).allowed).toBe(false);
  });

  it("leaves a small map alone, expired windows included", async () => {
    const time = clock();
    const throttle = memoryThrottle({ clientOf: () => "live", limits, now: time.now });
    await throttle(address("old@example.com"), request);
    time.advance(60);
    const deleted = vi.spyOn(Map.prototype, "delete");
    try {
      await throttle(client, request);
      expect(deleted).not.toHaveBeenCalled();
    } finally {
      deleted.mockRestore();
    }
  });

  // The address is attacker-chosen on start, so the map would otherwise grow without bound.
  it("sweeps expired windows once the map grows large, and only those", async () => {
    const time = clock();
    const throttle = memoryThrottle({ clientOf: () => "live", limits, now: time.now });
    await Promise.all(
      Array.from({ length: 10_001 }, (_, index) =>
        throttle(address(`old-${index}@example.com`), request),
      ),
    );
    const deleted = vi.spyOn(Map.prototype, "delete");
    try {
      await throttle(client, request);
      expect(deleted).not.toHaveBeenCalled();
      time.advance(60);
      await throttle(client, request);
      // Every address window expired; the client's, opened at the same instant, expired too.
      expect(deleted).toHaveBeenCalledTimes(10_002);
    } finally {
      deleted.mockRestore();
    }
  });

  it("defaults to limits that fit the provider's ten-minute code", () => {
    for (const step of Object.values(EMAIL_LIMITS)) {
      for (const limit of Object.values(step)) expect(limit.windowSeconds).toBe(600);
    }
    expect(EMAIL_LIMITS["email-verify"].address.attempts).toBeLessThanOrEqual(10);
  });
});
