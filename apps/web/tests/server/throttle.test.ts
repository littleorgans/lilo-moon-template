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

  // Once past the threshold with nothing expired, a sweep on every call would cost a full pass per
  // request, which is a cheap way for an attacker with many addresses to spend the server's CPU.
  it("rescans a map full of live windows at most once a minute", async () => {
    const time = clock();
    const throttle = memoryThrottle({ clientOf: () => "live", limits, now: time.now });
    await Promise.all(
      Array.from({ length: 10_001 }, (_, index) =>
        throttle(address(`live-${index}@example.com`), request),
      ),
    );
    const iterated = vi.spyOn(Map.prototype, Symbol.iterator);
    let passes: number;
    try {
      await attempts(throttle, client, 3);
      time.advance(59);
      await throttle(client, request);
      passes = iterated.mock.calls.length;
    } finally {
      iterated.mockRestore();
    }
    expect(passes).toBe(1);
  });

  // The address arrives at whatever length was submitted. Kept verbatim, one 100 KB address would
  // cost 100 KB for ten minutes.
  it("keys by a digest, so a long address costs what a short one does", async () => {
    const set = vi.spyOn(Map.prototype, "set");
    try {
      const throttle = memoryThrottle({ clientOf: () => "live", limits, now: clock().now });
      await throttle(address(`${"a".repeat(100_000)}@example.com`), request);
      const keys = set.mock.calls.map(([key]) => String(key));
      expect(keys).toHaveLength(1);
      expect(keys[0]?.length).toBeLessThan(100);
    } finally {
      set.mockRestore();
    }
  });

  const fill = (throttle: ReturnType<typeof memoryThrottle>, count: number, from = 0) =>
    Promise.all(
      Array.from({ length: count }, (_, index) =>
        throttle(address(`fill-${from + index}@example.com`), request),
      ),
    );

  // Rotating client addresses would otherwise grow the map with the request rate.
  it("caps the map by evicting the window opened longest ago", async () => {
    const throttle = memoryThrottle({ clientOf: () => "live", limits, now: clock().now });
    await throttle(address("first@example.com"), request);
    await fill(throttle, 99_999);
    // Full: the next new window evicts the first, whose budget starts over.
    await throttle(address("newest@example.com"), request);
    expect((await throttle(address("first@example.com"), request)).allowed).toBe(true);
    // Windows opened later are still counted.
    expect((await throttle(address("fill-99998@example.com"), request)).allowed).toBe(false);
  });

  it("counts a reopened window as the newest, not by when its key was first seen", async () => {
    const time = clock();
    const throttle = memoryThrottle({ clientOf: () => "live", limits, now: time.now });
    await throttle(address("first@example.com"), request);
    time.advance(30);
    // Opened after the first window and still live when it reopens. Few enough that no sweep runs.
    await fill(throttle, 9_000);
    time.advance(30);
    // Reopens the expired window, which moves it behind everything opened before now.
    await throttle(address("first@example.com"), request);
    await fill(throttle, 91_000, 9_000);
    // The cap evicted fill-0, opened longest ago, and left the reopened window counted.
    expect((await throttle(address("first@example.com"), request)).allowed).toBe(false);
    expect((await throttle(address("fill-0@example.com"), request)).allowed).toBe(true);
  });

  it("defaults to limits that fit the provider's ten-minute code", () => {
    for (const step of Object.values(EMAIL_LIMITS)) {
      for (const limit of Object.values(step)) expect(limit.windowSeconds).toBe(600);
    }
    expect(EMAIL_LIMITS["email-verify"].address.attempts).toBeLessThanOrEqual(10);
  });
});
