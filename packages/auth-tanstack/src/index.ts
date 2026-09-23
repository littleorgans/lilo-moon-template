// Re-exported so an application names the states its loader must branch on without depending on
// @littleorgans/auth-session directly. The adapter is the only auth package apps/web imports.
export type {
  Access,
  AuthFailureReport,
  Throttle,
  ThrottleDecision,
  ThrottleKey,
  ThrottleStep,
} from "@littleorgans/auth-session";
// Re-exported for an application's own POST routes, which the runtime does not handle.
export { refuseCrossOrigin } from "@littleorgans/auth-session";
export { requestCookies } from "./cookies.js";
export { reportAuthFailure } from "./log.js";
export { postHandlers } from "./routes.js";
export { createAuthRuntime } from "./runtime.js";
export type { AuthRuntime, AuthRuntimeOptions } from "./runtime.js";
