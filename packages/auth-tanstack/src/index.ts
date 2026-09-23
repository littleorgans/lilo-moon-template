// Re-exported so an application names the states its loader must branch on without depending on
// @littleorgans/auth-session directly. The adapter is the only auth package apps/web imports.
export type { Access, AuthFailureReport } from "@littleorgans/auth-session";
export { requestCookies } from "./cookies.js";
export { reportAuthFailure } from "./log.js";
export { postHandlers } from "./routes.js";
export { createAuthRuntime } from "./runtime.js";
export type { AuthRuntime, AuthRuntimeOptions } from "./runtime.js";
