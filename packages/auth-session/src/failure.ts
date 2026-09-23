import type { AuthFailure } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { WorkOSAuthFailure } from "@littleorgans/auth-workos";

/**
 * What the person is told when a sign-in cannot finish, and what is written down about it.
 *
 * `WorkOSAuthFailure` has sixteen values. Someone holding a laptop can act on four. Collapsing
 * them is the design decision; naming which ones collapse is what stops it becoming an accident.
 * The same rule already governs the token failures in `docs/auth-screens.md`.
 *
 * None of the messages names the provider's reason. Several of these failures are indistinguishable
 * from an attacker probing the callback, and a message that says which check failed tells them
 * which one to change.
 */
export type CallbackDisposition = "retry" | "unsupported" | "misconfigured";

/** The failure and the error behind it, for whoever is reading the logs. */
export interface CallbackFailure {
  readonly kind: "callback";
  readonly reason: WorkOSAuthFailure;
  readonly disposition: CallbackDisposition;
  readonly error: unknown;
}

/**
 * The same, raised by the email-code sign-in rather than the redirect callback.
 *
 * Its own kind so a collector can tell the flows apart: a spike in codes that could not be sent is
 * a different incident from a spike in redirects that could not be exchanged, and one event name
 * for both hides which. `step` says which half failed, sending the code or checking it.
 */
export interface EmailFailure {
  readonly kind: "email";
  readonly step: "start" | "verify";
  readonly reason: WorkOSAuthFailure;
  readonly disposition: CallbackDisposition;
  readonly error: unknown;
}

/**
 * A token that failed verification, for the same reader.
 *
 * Every reason is reported, not only the one that earns a screen. A signature that does not check
 * out may be somebody probing with a token they minted, and that is precisely the line an operator
 * wants to find later. What differs between the reasons is what the person is told, not whether
 * anyone is told.
 */
export interface TokenFailure {
  readonly kind: "token";
  readonly reason: AuthFailure | WorkOSAuthFailure;
  /**
   * What the person sees: `ended` sends them to sign in again, `broken` says this one is ours.
   * `signed-in` is a refresh started before expiry that failed while the token still verified, so
   * the person was served that token and nothing else changed.
   */
  readonly status: "signed-in" | "ended" | "broken" | "unavailable";
  readonly error: unknown;
}

/** Everything an application's log sink is handed. One sink, so one place to point at a collector. */
export type AuthFailureReport = CallbackFailure | EmailFailure | TokenFailure;

const MESSAGES: Readonly<Record<CallbackDisposition, string>> = {
  // Nothing is wrong with the account or the configuration. Waiting is the whole remedy.
  retry: "Sign-in is temporarily unavailable. Try again in a moment.",
  // The provider is asking for a step this application has not built. Saying so is honest and
  // stops the person retrying a flow that cannot complete no matter how many times they press it.
  unsupported: "This account needs a sign-in step this application does not support yet.",
  // Ours to fix, and unfixable by the person reading it. Sending them back to a button they will
  // press forever is the worst available response.
  misconfigured: "Sign-in is not set up correctly here. The problem has been recorded.",
};

export function dispositionFor(reason: WorkOSAuthFailure): CallbackDisposition {
  switch (reason) {
    case "rate-limited":
    case "unavailable":
      return "retry";
    // The one failure the person can fix, and the email flow acts on it before this collapse:
    // completeEmailSignIn returns the person to the code entry page instead of rendering a
    // disposition message. The mapping here is for the log line, where "try again" is accurate.
    case "code-rejected":
      return "retry";
    case "email-verification-required":
    case "organization-selection-required":
    case "mfa-enrollment-required":
    case "mfa-challenge-required":
    case "mfa-verification-required":
    case "radar-challenge-required":
    case "sso-required":
      return "unsupported";
    case "invalid-request":
    case "unauthorized":
    case "not-found":
    case "conflict":
    case "configuration":
    case "provider":
      return "misconfigured";
    default: {
      // A new member of the union stops compiling here rather than silently becoming a blank page.
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * Reads the reason off a translated provider error.
 *
 * Anything else is `provider`, which is the union's own word for "the vendor did something we have
 * no name for". A callback must render something for every throw, including the ones that never
 * reached the vendor at all.
 */
export function reasonFor(error: unknown): WorkOSAuthFailure {
  return error instanceof WorkOSAuthError ? error.reason : "provider";
}

/**
 * The status a disposition is served with, so monitoring can tell an outage from a person's error.
 *
 * Only `retry` leaves 400. Its two reasons, a rate limit and a provider outage, are the provider
 * being unable to serve anyone, which is what 503 says and what an alert on 5xx should hear.
 * `unsupported` is a property of the account signing in, not of the service. `misconfigured` stays
 * 400 too, although it holds reasons that are ours: `invalid-request` is the provider calling the
 * request malformed, which a submitted value can cause as easily as our code, and a 5xx for that
 * would page someone for a typo. Its log line, not its status, is what makes a wrong API key findable.
 */
const STATUSES: Readonly<Record<CallbackDisposition, number>> = {
  retry: 503,
  unsupported: 400,
  misconfigured: 400,
};

/**
 * The page a failed sign-in renders.
 *
 * Deliberately plain, with no stylesheet and no client script. Sign-in failing is not the moment to
 * discover a styling dependency, and this page has to render when everything else in the request is
 * broken.
 *
 * 400 by default, for the failures the request itself caused: a forged or stale state, a missing
 * code, an empty address. A provider refusal goes through `dispositionPage`, which picks the status.
 */
export function failurePage(message: string, status = 400): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head>` +
      `<body><h1>Sign-in failed</h1><p>${message}</p><p><a href="/">Back to sign in</a></p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function messageFor(disposition: CallbackDisposition): string {
  return MESSAGES[disposition];
}

export function statusFor(disposition: CallbackDisposition): number {
  return STATUSES[disposition];
}

/** The page for a provider refusal: the disposition's message, served with its status. */
export function dispositionPage(disposition: CallbackDisposition): Response {
  return failurePage(messageFor(disposition), statusFor(disposition));
}
