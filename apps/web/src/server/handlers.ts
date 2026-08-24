import { handleCallback, signOut, startAuthorization } from "@lilo-moon/auth-session";

import { requestCookies } from "./cookies.js";
import { getServices } from "./services.js";

/**
 * Binds the shared handlers to this application's live dependencies.
 *
 * The handlers take their collaborators as arguments so the package can be tested without a server.
 * That leaves someone to supply the real ones, and doing it here keeps the route files free of any
 * function at all: a closure written inside a route definition is unreachable from a test.
 */
export function startSignIn(context: unknown): Response {
  const { auth, config } = getServices();
  return startAuthorization(context, requestCookies, {
    authorizationUrl: (state) =>
      auth.getAuthorizationUrl({
        redirectUri: config.redirectUri,
        state,
        provider: "GoogleOAuth",
      }),
    secureCookies: config.secureCookies,
  });
}

export async function completeSignIn(context: { readonly request: Request }): Promise<Response> {
  const { auth, config } = getServices();
  return await handleCallback(context, requestCookies, {
    auth,
    cookieKey: config.cookieKey,
    secureCookies: config.secureCookies,
  });
}

export function endSession(context: unknown): Response {
  return signOut(context, requestCookies);
}
