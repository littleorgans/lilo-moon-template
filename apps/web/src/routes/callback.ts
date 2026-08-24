import type { Authentication, WorkOSAuth } from "@lilo-moon/auth-workos";
import { createFileRoute } from "@tanstack/react-router";

import { requestCookies } from "../server/cookies.js";
import type { CookieJar } from "../server/cookies.js";
import { getServices } from "../server/services.js";
import { SESSION_COOKIE, STATE_COOKIE, seal, stateMatches } from "../server/session.js";

/** A year. The refresh token inside rotates; this is only how long the browser keeps the envelope. */
const SESSION_MAX_AGE_SECONDS = 31_536_000;

function failure(message: string): Response {
  // Deliberately plain. Sign-in failing is not the moment to discover a styling dependency, and
  // this page must render when everything else in the request is broken.
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head>` +
      `<body><h1>Sign-in failed</h1><p>${message}</p><p><a href="/">Back to sign in</a></p></body></html>`,
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

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

export interface CallbackDeps {
  readonly auth: WorkOSAuth;
  readonly cookieKey: Buffer;
  readonly secureCookies: boolean;
}

function liveDeps(): CallbackDeps {
  const { auth, config } = getServices();
  return { auth, cookieKey: config.cookieKey, secureCookies: config.secureCookies };
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
  jar: CookieJar = requestCookies,
  deps: CallbackDeps = liveDeps(),
): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // The state check runs before anything else touches the code. Everything below this line assumes
  // the response is one this application asked for, and nothing above it may assume that.
  if (!stateMatches(jar.read(STATE_COOKIE), url.searchParams.get("state"))) {
    return failure("This sign-in link did not come from here, or it has expired.");
  }
  // Cleared whether or not the rest succeeds. A state that stays valid is one an attacker can
  // replay, so it is spent the moment it is checked.
  jar.clear(STATE_COOKIE);

  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) {
    return failure("The provider did not return an authorization code.");
  }

  const userAgent = request.headers.get("user-agent");
  const authentication = await ensureOrganization(
    deps.auth,
    await deps.auth.authenticateWithCode({
      code,
      ...(userAgent === null ? {} : { userAgent }),
    }),
  );

  jar.write(
    SESSION_COOKIE,
    seal(deps.cookieKey, {
      accessToken: authentication.accessToken,
      refreshToken: authentication.refreshToken,
    }),
    {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );

  return new Response(null, { status: 302, headers: { location: "/app" } });
}

export const Route = createFileRoute("/callback")({
  server: { handlers: { GET: handleCallback } },
});
