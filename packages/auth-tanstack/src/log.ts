import type { CallbackFailure } from "@lilo-moon/auth-session";

/**
 * The default destination for a refused sign-in: one JSON line per failure, on stderr.
 *
 * Structured rather than a formatted sentence, because what eventually reads it is a collector and
 * not a person scrolling a terminal.
 *
 * The error is reduced to its message rather than serialised whole. A `WorkOSAuthError` carries a
 * `cause` chain holding the vendor's raw exception, which most serialisers either throw on or
 * expand into the response body it came from. A logger that throws inside a failure path hides the
 * failure it was called about.
 *
 * Exported so an application that wants its own logging can wrap this rather than reimplement it.
 */
export function reportAuthFailure(failure: CallbackFailure): void {
  console.error(
    JSON.stringify({
      event: "auth.callback.failed",
      reason: failure.reason,
      disposition: failure.disposition,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    }),
  );
}
