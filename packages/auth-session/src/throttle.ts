/** The steps that make the provider send an email or check a code, and so are worth abusing. */
export type ThrottleStep = "email-start" | "email-verify";

/**
 * One budget a step draws from.
 *
 * `client` is whoever sent the request. This package cannot name them: a `Request` carries no
 * socket address, and whether `X-Forwarded-For` can be trusted depends on the deployment. So the
 * throttle derives the client from the request it is given. `address` is the email the step acts
 * on, lower-cased so that case variants share one budget. On verify it is the address the code was
 * sent to, so it caps guesses at one code however many clients make them. It is whatever was
 * submitted, of any length, so a store should key by a digest of it rather than the address itself.
 */
export type ThrottleKey =
  | { readonly step: ThrottleStep; readonly by: "client" }
  | { readonly step: ThrottleStep; readonly by: "address"; readonly address: string };

export type ThrottleDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * Asked once per key before each provider call; each call counts as an attempt.
 *
 * The package ships no implementation, because a limiter that works has to share its counts
 * between every instance of the application: one kept in process memory allows each instance its
 * own full budget, and forgets everything on restart. Back it with a shared store, or pass one that
 * always allows when something in front of the application already limits these routes. A throttle
 * that rejects fails the request.
 */
export type Throttle = (key: ThrottleKey, request: Request) => Promise<ThrottleDecision>;

/**
 * Asks about each key in order and answers the first refusal with 429 and `Retry-After`, or returns
 * null when every key allows. Stops at the first refusal, so a client already over its budget does
 * not also spend the address's.
 */
export async function throttled(
  throttle: Throttle,
  request: Request,
  keys: readonly ThrottleKey[],
): Promise<Response | null> {
  const [key, ...rest] = keys;
  if (key === undefined) return null;
  const decision = await throttle(key, request);
  if (!decision.allowed) return tooManyAttempts(decision.retryAfterSeconds);
  return await throttled(throttle, request, rest);
}

function tooManyAttempts(retryAfterSeconds: number): Response {
  // Retry-After takes whole, non-negative seconds. Rounding down could tell a client to come back
  // before its window reopens.
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Too many attempts</title></head>` +
      `<body><h1>Too many attempts</h1><p>Wait a few minutes, then try again.</p>` +
      `<p><a href="/">Back to sign in</a></p></body></html>`,
    {
      status: 429,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": String(seconds) },
    },
  );
}
