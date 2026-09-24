import type { WorkOSAuth } from "@littleorgans/auth-workos";

import { ensureOrganization, establishSession } from "./callback.js";
import type { SessionDeps } from "./callback.js";
import type { CookieJar } from "./cookies.js";
import { dispositionFor, failurePage, providerFailurePage, reasonFor } from "./failure.js";
import type { EmailFailure } from "./failure.js";
import { refuseCrossOrigin } from "./origin.js";
import { EMAIL_COOKIE } from "./session.js";
import { throttled } from "./throttle.js";
import type { Throttle, ThrottleStep } from "./throttle.js";

/** Matches the provider's ten-minute code lifetime. The cookie has no reason to outlive the code. */
const EMAIL_MAX_AGE_SECONDS = 600;

/**
 * RFC 5321's limit on a path, so nothing longer can be delivered to. Refused before the throttle
 * and the provider see it: the address becomes a throttle key, and a store that keeps it verbatim
 * would otherwise hold whatever length was submitted.
 */
const EMAIL_MAX_LENGTH = 254;

/** Reads one field out of a submitted form, collapsing every absent shape to null. */
async function formField(request: Request, name: string): Promise<string | null> {
  const value = (await request.formData()).get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Both budgets a step draws from, client first. See `ThrottleKey` for why these two. */
function keysFor(step: ThrottleStep, email: string) {
  return [
    { step, by: "client" },
    { step, by: "address", address: email.toLowerCase() },
  ] as const;
}

/** What both email steps need to refuse a request before it reaches the provider. */
interface EmailGuardDeps {
  /** Any URL on the application's own origin. A POST whose Origin differs is refused with 403. */
  readonly origin: string;
  /** Asked before every provider call. Required, so every application decides; see `Throttle`. */
  readonly throttle: Throttle;
}

export interface EmailStartDeps extends EmailGuardDeps {
  readonly auth: WorkOSAuth;
  readonly secureCookies: boolean;
  /** Where the person types the code. The application's route, not this package's. */
  readonly codeEntryPath: string;
  /** Told about every failure the provider raises, same contract as the callback's. */
  readonly log: (failure: EmailFailure) => void;
}

/**
 * Starts an email-code sign-in: the provider mints and emails a six-digit code.
 *
 * The address is remembered in a short-lived httpOnly cookie rather than a URL, so it never lands
 * in a history entry, a referrer, or a server access log. The verify step reads it back, which is
 * also what ties the code entry to the browser that asked for it: a code pasted into someone
 * else's browser has no address to verify against.
 *
 * The provider creates the user when the address is new, measured against the live API, so this
 * one flow is both sign-in and sign-up. The organization arrives at verification, exactly as it
 * does on the OAuth path.
 *
 * A page on another origin could otherwise make any visitor's browser send codes to any address,
 * so the Origin is checked first, and the throttle is asked before the provider sends anything.
 */
export async function startEmailSignIn(
  context: { readonly request: Request },
  jar: CookieJar,
  deps: EmailStartDeps,
): Promise<Response> {
  const refused = refuseCrossOrigin(context.request, deps.origin);
  if (refused !== null) return refused;

  const email = await formField(context.request, "email");
  if (email === null || email.length > EMAIL_MAX_LENGTH) {
    return failurePage("Enter the email address you want the code sent to.");
  }

  const limited = await throttled(deps.throttle, context.request, keysFor("email-start", email));
  if (limited !== null) return limited;

  const userAgent = context.request.headers.get("user-agent");
  try {
    await deps.auth.sendMagicAuthCode({
      email,
      ...(userAgent === null ? {} : { userAgent }),
    });
  } catch (error) {
    const reason = reasonFor(error);
    const disposition = dispositionFor(reason);
    deps.log({ kind: "email", step: "start", reason, disposition, error });
    return providerFailurePage(reason);
  }

  // Written only after the provider accepted the address, so the cookie always names an email a
  // code was really sent to.
  jar.write(EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: deps.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: EMAIL_MAX_AGE_SECONDS,
  });

  return new Response(null, { status: 302, headers: { location: deps.codeEntryPath } });
}

export interface EmailVerifyDeps extends SessionDeps, EmailGuardDeps {
  readonly auth: WorkOSAuth;
  /** Where the person is sent back to when the code they typed is not the code that was sent. */
  readonly codeEntryPath: string;
  readonly log: (failure: EmailFailure) => void;
}

/**
 * Finishes an email-code sign-in, from the submitted code to a session cookie.
 *
 * A rejected code is the one provider failure the person can fix, so it returns them to the code
 * entry page with a retry marker instead of a disposition message, and the address cookie stays:
 * they are mid-flow, not starting over. Every other failure collapses exactly as the callback's
 * do. Success runs the same organization provisioning and lands in the same `establishSession`.
 *
 * Every submitted code draws on the address's budget, which is what bounds guessing a six-digit
 * code. A refused attempt keeps the address cookie, for the same reason a typo does.
 */
export async function completeEmailSignIn(
  context: { readonly request: Request },
  jar: CookieJar,
  deps: EmailVerifyDeps,
): Promise<Response> {
  const refused = refuseCrossOrigin(context.request, deps.origin);
  if (refused !== null) return refused;

  // The cookie is plain text, so its length is whatever the browser sent, not what start wrote.
  const email = jar.read(EMAIL_COOKIE);
  if (email === undefined || email.length === 0 || email.length > EMAIL_MAX_LENGTH) {
    return failurePage("This sign-in has expired. Start again from the sign-in page.");
  }

  const retry = new Response(null, {
    status: 302,
    headers: { location: `${deps.codeEntryPath}?retry=true` },
  });

  const code = await formField(context.request, "code");
  if (code === null) return retry;

  const limited = await throttled(deps.throttle, context.request, keysFor("email-verify", email));
  if (limited !== null) return limited;

  const userAgent = context.request.headers.get("user-agent");
  let response: Response;
  try {
    const authentication = await ensureOrganization(
      deps.auth,
      await deps.auth.verifyMagicAuthCode({
        email,
        code,
        ...(userAgent === null ? {} : { userAgent }),
      }),
      deps.organizationPolicy,
    );
    response = establishSession(jar, deps, authentication);
  } catch (error) {
    const reason = reasonFor(error);
    const disposition = dispositionFor(reason);
    deps.log({ kind: "email", step: "verify", reason, disposition, error });
    if (reason === "code-rejected") return retry;
    return providerFailurePage(reason);
  }

  // Spent only on success. A typo must not cost the person the address they already proved they
  // wanted a code sent to.
  jar.clear(EMAIL_COOKIE);
  return response;
}
