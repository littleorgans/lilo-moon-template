import type { AuthFailureReport } from "@littleorgans/auth-session";

/**
 * The default destination for every auth failure: one JSON line each, on stderr.
 *
 * Structured rather than a formatted sentence, because what eventually reads it is a collector and
 * not a person scrolling a terminal. One sink for refused sign-ins and rejected tokens alike, so an
 * application points one thing at its logging rather than two. The event is named for the kind:
 * `auth.callback.failed`, `auth.email.failed` or `auth.token.failed`.
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
      event: `auth.${failure.kind}.failed`,
      // Which half of the email sign-in failed: sending the code, or checking it.
      ...(failure.kind === "email" ? { step: failure.step } : {}),
      reason: failure.reason,
      // A sign-in failure carries what the person was told; a token failure carries what happened
      // to their session. Both answer "and then what", which is why the line is worth reading.
      outcome: failure.kind === "token" ? failure.status : failure.disposition,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    }),
  );
}
