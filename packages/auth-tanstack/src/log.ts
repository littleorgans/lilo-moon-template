import type { AuthFailureReport } from "@lilo-moon/auth-session";

/**
 * The default destination for every auth failure: one JSON line each, on stderr.
 *
 * Structured rather than a formatted sentence, because what eventually reads it is a collector and
 * not a person scrolling a terminal. One sink for refused sign-ins and rejected tokens alike, so an
 * application points one thing at its logging rather than two.
 *
 * The error is reduced to its message rather than serialised whole. A `WorkOSAuthError` carries a
 * `cause` chain holding the vendor's raw exception, which most serialisers either throw on or
 * expand into the response body it came from. A logger that throws inside a failure path hides the
 * failure it was called about.
 *
 * Exported so an application that wants its own logging can wrap this rather than reimplement it.
 */
export function reportAuthFailure(failure: AuthFailureReport): void {
  console.error(
    JSON.stringify({
      event: failure.kind === "callback" ? "auth.callback.failed" : "auth.token.failed",
      reason: failure.reason,
      // A callback failure carries what the person was told; a token failure carries what happened
      // to their session. Both answer "and then what", which is why the line is worth reading.
      outcome: failure.kind === "callback" ? failure.disposition : failure.status,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    }),
  );
}
