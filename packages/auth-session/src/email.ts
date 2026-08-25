import type { WorkOSAuth } from "@lilo-moon/auth-workos";

import { ensureOrganization, establishSession } from "./callback.js";
import type { SessionDeps } from "./callback.js";
import type { CookieJar } from "./cookies.js";
import { dispositionFor, failurePage, messageFor, reasonFor } from "./failure.js";
import type { CallbackFailure } from "./failure.js";
import { EMAIL_COOKIE } from "./session.js";

/** Matches the provider's ten-minute code lifetime. The cookie has no reason to outlive the code. */
const EMAIL_MAX_AGE_SECONDS = 600;

/** Reads one field out of a submitted form, collapsing every absent shape to null. */
async function formField(request: Request, name: string): Promise<string | null> {
  const value = (await request.formData()).get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export interface EmailStartDeps {
  readonly auth: WorkOSAuth;
  readonly secureCookies: boolean;
  /** Where the person types the code. The application's route, not this package's. */
  readonly codeEntryPath: string;
  /** Told about every failure the provider raises, same contract as the callback's. */
  readonly log: (failure: CallbackFailure) => void;
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
 */
export async function startEmailSignIn(
  context: { readonly request: Request },
  jar: CookieJar,
  deps: EmailStartDeps,
): Promise<Response> {
  const email = await formField(context.request, "email");
  if (email === null) {
    return failurePage("Enter the email address you want the code sent to.");
  }

  const userAgent = context.request.headers.get("user-agent");
  try {
    await deps.auth.sendMagicAuthCode({
      email,
      ...(userAgent === null ? {} : { userAgent }),
    });
  } catch (error) {
    const reason = reasonFor(error);
    const disposition = dispositionFor(reason);
    deps.log({ kind: "callback", reason, disposition, error });
    return failurePage(messageFor(disposition));
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

export interface EmailVerifyDeps extends SessionDeps {
  readonly auth: WorkOSAuth;
  /** Where the person is sent back to when the code they typed is not the code that was sent. */
  readonly codeEntryPath: string;
  readonly log: (failure: CallbackFailure) => void;
}

/**
 * Finishes an email-code sign-in, from the submitted code to a session cookie.
 *
 * A rejected code is the one provider failure the person can fix, so it returns them to the code
 * entry page with a retry marker instead of a disposition message, and the address cookie stays:
 * they are mid-flow, not starting over. Every other failure collapses exactly as the callback's
 * do. Success runs the same organization provisioning and lands in the same `establishSession`.
 */
export async function completeEmailSignIn(
  context: { readonly request: Request },
  jar: CookieJar,
  deps: EmailVerifyDeps,
): Promise<Response> {
  const email = jar.read(EMAIL_COOKIE);
  if (email === undefined || email.length === 0) {
    return failurePage("This sign-in has expired. Start again from the sign-in page.");
  }

  const retry = new Response(null, {
    status: 302,
    headers: { location: `${deps.codeEntryPath}?retry=true` },
  });

  const code = await formField(context.request, "code");
  if (code === null) return retry;

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
    );
    response = establishSession(jar, deps, authentication);
  } catch (error) {
    const reason = reasonFor(error);
    const disposition = dispositionFor(reason);
    deps.log({ kind: "callback", reason, disposition, error });
    if (reason === "code-rejected") return retry;
    return failurePage(messageFor(disposition));
  }

  // Spent only on success. A typo must not cost the person the address they already proved they
  // wanted a code sent to.
  jar.clear(EMAIL_COOKIE);
  return response;
}
