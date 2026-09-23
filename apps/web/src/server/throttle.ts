import type { Throttle, ThrottleKey, ThrottleStep } from "@littleorgans/auth-tanstack";

interface Limit {
  readonly attempts: number;
  readonly windowSeconds: number;
}

type Limits = Readonly<Record<ThrottleStep, Readonly<Record<ThrottleKey["by"], Limit>>>>;

/**
 * Ten minutes is the provider's code lifetime, so a window never outlasts the code it guards. Ten
 * guesses at a six-digit code per address per window is a one-in-a-hundred-thousand chance, and a
 * person who mistypes gets several tries.
 */
export const EMAIL_LIMITS: Limits = {
  "email-start": {
    client: { attempts: 10, windowSeconds: 600 },
    address: { attempts: 3, windowSeconds: 600 },
  },
  "email-verify": {
    client: { attempts: 30, windowSeconds: 600 },
    address: { attempts: 10, windowSeconds: 600 },
  },
};

// Stale windows are swept only once the map grows past this, so a quiet server does no work.
const SWEEP_ABOVE = 10_000;

export interface MemoryThrottleOptions {
  /**
   * Who sent the request. Behind a proxy the socket address is the proxy's, which puts every client
   * in one budget; trust a forwarded address only when the proxy sets it.
   */
  readonly clientOf: (request: Request) => string | undefined;
  readonly limits?: Limits;
  readonly now?: () => number;
}

/**
 * A fixed-window counter held in this process's memory.
 *
 * Right for one instance and for development, and wrong for anything more. Every instance keeps
 * its own counts, so N instances allow N times each budget, and a restart forgets them all. An
 * application that runs more than one instance replaces this with a throttle over a shared store,
 * such as Redis or its database, keeping the same keys and limits.
 */
export function memoryThrottle({
  clientOf,
  limits = EMAIL_LIMITS,
  now = Date.now,
}: MemoryThrottleOptions): Throttle {
  const windows = new Map<string, { count: number; resetsAt: number }>();

  return (key, request) => {
    const at = now();
    if (windows.size > SWEEP_ABOVE) {
      for (const [id, window] of windows) if (window.resetsAt <= at) windows.delete(id);
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
