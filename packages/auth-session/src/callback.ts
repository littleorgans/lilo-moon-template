import type { Authentication, WorkOSAuth } from "@lilo-moon/auth-workos";

import type { CookieJar } from "./cookies.js";
import { dispositionFor, failurePage, messageFor, reasonFor } from "./failure.js";
import type { CallbackFailure } from "./failure.js";
import type { SessionCookieDeps } from "./session.js";
import { STATE_COOKIE, stateMatches, writeSession } from "./session.js";

/**
 * Names the organization for someone who has just arrived without one.
 *
 * A social sign-in supplies a name and the email-code path does not, so the email is the fallback
 * rather than the preference. The whole address, not the local part: this is what appears in a
 * workspace switcher, and local parts collide constantly.
 */
export function organizationNameFor(user: Authentication["user"]): string {
  const given = user.firstName ?? user.name;
  return given === null || given.length === 0 ? user.email : `${given}'s workspace`;
}

/**
 * Gives a brand new user their tenant.
 *
 * WorkOS has no setting that does this, so it is permanently application code. Three things matter
 * and each has already cost somebody something:
 *
 * No domains are attached. An organization owning a verified domain captures every address at that
 * domain, and domain-based SSO routing runs ahead of password auth, so a personal workspace
 * claiming a company domain would silently pull in colleagues. On a consumer domain it would be
 * far worse.
 *
 * The idempotency key is the user id, so a callback delivered twice, or two tabs finishing at once,
 * cannot leave one person holding two organizations with no way to tell which is real.
 *
 * The token is refreshed afterwards because membership does not retroactively appear in a token
 * that was already minted. Without the refresh, `org_id` stays absent until the token expires.
 */
export async function ensureOrganization(
  auth: WorkOSAuth,
  authentication: Authentication,
): Promise<Authentication> {
  if (authentication.organizationId !== null) return authentication;

  const organization = await auth.provisionOrganization({
    name: organizationNameFor(authentication.user),
    userId: authentication.user.id,
    idempotencyKey: `signup:${authentication.user.id}`,
  });

  return await auth.refreshTokens({
    refreshToken: authentication.refreshToken,
    organizationId: organization.organizationId,
  });
}

export interface SessionDeps extends SessionCookieDeps {
  /** Where a completed sign-in lands. The application's choice, not this package's. */
  readonly signedInPath: string;
}

/**
 * Seals the tokens into the session cookie and hands the browser to the signed-in page.
 *
 * The one ending every sign-in path shares, whatever proved the identity: an OAuth code exchange
 * and an email code verification both finish exactly here.
 */
export function establishSession(
  jar: CookieJar,
  deps: SessionDeps,
  authentication: Authentication,
): Response {
  writeSession(jar, deps, {
    accessToken: authentication.accessToken,
    refreshToken: authentication.refreshToken,
  });

  return new Response(null, { status: 302, headers: { location: deps.signedInPath } });
}

export interface CallbackDeps extends SessionDeps {
  readonly auth: WorkOSAuth;
  /**
   * Told about every failure the provider raises.
   *
   * Required rather than optional. Catching an error to render a page swallows the stack trace the
   * framework would otherwise have printed, so a callback that renders without reporting trades a
   * bad page for a silent outage. Injected rather than written to the console here because a
   * library that picks its own log destination is one an application cannot fit into its own.
   */
  readonly log: (failure: CallbackFailure) => void;
}

/**
 * The whole redirect sign-in, from the provider's response to a session cookie.
 *
 * Dependencies are defaulted arguments rather than reached for inside, so the order below can be
 * exercised against a recording jar. That order is the security boundary and a boundary that only
 * runs inside a live request never gets tested.
 */
export async function handleCallback(
  context: { readonly request: Request },
  jar: CookieJar,
  deps: CallbackDeps,
): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // The state check runs before anything else touches the code. Everything below this line assumes
  // the response is one this application asked for, and nothing above it may assume that.
  if (!stateMatches(jar.read(STATE_COOKIE), url.searchParams.get("state"))) {
    return failurePage("This sign-in link did not come from here, or it has expired.");
  }
  // Cleared whether or not the rest succeeds. A state that stays valid is one an attacker can
  // replay, so it is spent the moment it is checked.
  jar.clear(STATE_COOKIE);

  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) {
    return failurePage("The provider did not return an authorization code.");
  }

  const userAgent = request.headers.get("user-agent");
  let authentication: Authentication;
  try {
    authentication = await ensureOrganization(
      deps.auth,
      await deps.auth.authenticateWithCode({
        code,
        ...(userAgent === null ? {} : { userAgent }),
      }),
    );
  } catch (error) {
    // Everything from here to the session cookie is a call to the vendor, and every one of them can
    // fail for a reason the person cannot see. Uncaught, they leave the framework to serialise an
    // exception into the response, which is how a wrong API key became `{"status":400,
    // "message":"HTTPError"}` on screen.
    const reason = reasonFor(error);
    const disposition = dispositionFor(reason);
    deps.log({ kind: "callback", reason, disposition, error });
    return failurePage(messageFor(disposition));
  }

  return establishSession(jar, deps, authentication);
}
