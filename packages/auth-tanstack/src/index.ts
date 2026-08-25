// Re-exported so an application names the states its loader must branch on without depending on
// @lilo-moon/auth-session directly. The adapter is the only auth package apps/web imports.
export type { Access, AuthFailureReport } from "@lilo-moon/auth-session";
export { requestCookies } from "./cookies.js";
export { reportAuthFailure } from "./log.js";
export {
  callbackRoute,
  emailStartRoute,
  emailVerifyRoute,
  signOutRoute,
  startRoute,
} from "./routes.js";
export { createAuthRuntime } from "./runtime.js";
export type { AuthRuntime, AuthRuntimeOptions } from "./runtime.js";
