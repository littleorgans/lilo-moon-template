import { WorkOSAuthError } from "@lilo-moon/auth-workos";
import type { WorkOSAuthFailure } from "@lilo-moon/auth-workos";

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
  readonly reason: WorkOSAuthFailure;
  readonly disposition: CallbackDisposition;
  readonly error: unknown;
}

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
 * The page a failed sign-in renders.
 *
 * Deliberately plain, with no stylesheet and no client script. Sign-in failing is not the moment to
 * discover a styling dependency, and this page has to render when everything else in the request is
 * broken.
 */
export function failurePage(message: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head>` +
      `<body><h1>Sign-in failed</h1><p>${message}</p><p><a href="/">Back to sign in</a></p></body></html>`,
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function messageFor(disposition: CallbackDisposition): string {
  return MESSAGES[disposition];
}
