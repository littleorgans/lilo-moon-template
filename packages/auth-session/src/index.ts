/**
 * The package's contract, and deliberately smaller than the sum of its modules.
 *
 * What belongs here: the operations an adapter calls to build the HTTP half of auth, the types
 * naming their arguments and their log payloads, and what a test of such an adapter needs to plant
 * a session and read one back. `@lilo-moon/auth-tanstack` is the reference for that list.
 *
 * What does not: the steps those operations are made of. `stateMatches`, `dispositionFor`,
 * `readSession` and the rest stay exported from their own modules, because sibling modules and the
 * colocated tests import them by path, and stay out of here, because a barrel that names its own
 * internals turns every refactor of them into a breaking change.
 */
export { readAccess } from "./access.js";
export type { Access, AccessDeps } from "./access.js";
export { startAuthorization } from "./authorize.js";
export type { AuthorizeDeps } from "./authorize.js";
export { handleCallback } from "./callback.js";
export type { CallbackDeps, SessionDeps } from "./callback.js";
export { completeEmailSignIn, startEmailSignIn } from "./email.js";
export type { EmailStartDeps, EmailVerifyDeps } from "./email.js";
export { loadAuthConfig } from "./config.js";
export type { AuthConfig } from "./config.js";
export type { CookieJar, CookieOptions } from "./cookies.js";
export type {
  AuthFailureReport,
  CallbackDisposition,
  CallbackFailure,
  TokenFailure,
} from "./failure.js";
export { signOut } from "./signout.js";
export { createAuthServices } from "./services.js";
export type { AuthServices } from "./services.js";
// The cookie names are a contract with the browser rather than an implementation detail: an
// application may need to clear one. `seal` and `unseal` are the pair that lets a test start a
// request already signed in, and assert on what the response wrote back.
export { EMAIL_COOKIE, SESSION_COOKIE, STATE_COOKIE, seal, unseal } from "./session.js";
export type { SessionCookieDeps } from "./session.js";
