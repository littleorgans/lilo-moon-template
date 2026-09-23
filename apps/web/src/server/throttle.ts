import type { Throttle, ThrottleKey, ThrottleStep } from "@littleorgans/auth-tanstack";

export interface Limit {
  readonly attempts: number;
  readonly windowSeconds: number;
}

export type ThrottleLimits = Readonly<
  Record<ThrottleStep, Readonly<Record<ThrottleKey["by"], Limit>>>
>;

/**
 * Ten minutes is the provider's code lifetime, so a window never outlasts the code it guards. Ten
 * guesses at a six-digit code per address per window is a one-in-a-hundred-thousand chance, and a
 * person who mistypes gets several tries.
 *
 * Windows are fixed, not sliding: a client that spends a budget in the last second of one window
 * and the first of the next gets twice the budget in two seconds. That doubles the numbers above,
 * which still leaves guessing at one code in the noise, and costs nothing per request.
 */
export const EMAIL_LIMITS: ThrottleLimits = {
  "email-start": {
    client: { attempts: 10, windowSeconds: 600 },
    address: { attempts: 3, windowSeconds: 600 },
  },
  "email-verify": {
    client: { attempts: 30, windowSeconds: 600 },
    address: { attempts: 10, windowSeconds: 600 },
  },
};

// Stale windows are swept only once the map grows past this, so a quiet server does no work, and
// then at most this often, so a map full of live windows costs one pass a minute, not one a request.
const SWEEP_ABOVE = 10_000;
const SWEEP_EVERY_MS = 60_000;

export interface MemoryThrottleOptions {
  /**
   * Who sent the request. Behind a proxy the socket address is the proxy's, which puts every client
   * in one budget and refuses them all together once it is spent. Read the forwarded address
   * instead, `getRequestIP({ xForwardedFor: true })`, only when a proxy you control overwrites that
   * header; a client can otherwise set it and choose its own budget.
   */
  readonly clientOf: (request: Request) => string | undefined;
  readonly limits?: ThrottleLimits;
  readonly now?: () => number;
}

/**
 * A fixed-window counter held in this process's memory.
 *
 * Right for one instance and for development, and wrong for anything more. Every instance keeps
 * its own counts, so N instances allow N times each budget, and a restart forgets them all. An
 * application that runs more than one instance replaces this with a throttle over a shared store,
 * such as Redis or its database, keeping the same keys and limits.
 *
 * The map holds one window per key seen in the last ten minutes. The address is attacker-chosen, so
 * it grows with the number of clients that can still spend, times each client's start budget; the
 * client budget is what bounds it, which is one more reason to identify clients correctly.
 */
export function memoryThrottle({
  clientOf,
  limits = EMAIL_LIMITS,
  now = Date.now,
}: MemoryThrottleOptions): Throttle {
  const windows = new Map<string, { count: number; resetsAt: number }>();
  let sweptAt = Number.NEGATIVE_INFINITY;

  return (key, request) => {
    const at = now();
    if (windows.size > SWEEP_ABOVE && at - sweptAt >= SWEEP_EVERY_MS) {
      for (const [id, window] of windows) if (window.resetsAt <= at) windows.delete(id);
      sweptAt = at;
    }

    const limit = limits[key.step][key.by];
    const who = key.by === "address" ? key.address : (clientOf(request) ?? "unknown");
    const id = `${key.step}:${key.by}:${who}`;
    let window = windows.get(id);
    if (window === undefined || window.resetsAt <= at) {
      window = { count: 0, resetsAt: at + limit.windowSeconds * 1000 };
      windows.set(id, window);
    }
    window.count += 1;
    return Promise.resolve(
      window.count <= limit.attempts
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: (window.resetsAt - at) / 1000 },
    );
  };
}
