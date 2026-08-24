import type { AuthRuntime } from "./runtime.js";

/**
 * Route options for the three server routes a redirect sign-in needs.
 *
 * These return options rather than routes because TanStack generates its route tree from file
 * paths: a route's path *is* where its file lives, so the file has to exist in the application.
 * What these remove is everything inside it.
 *
 *     import { createFileRoute } from "@tanstack/react-router";
 *     import { callbackRoute } from "@lilo-moon/auth-tanstack";
 *     import { auth } from "../server/auth.js";
 *
 *     export const Route = createFileRoute("/callback")(callbackRoute(auth));
 */
export function startRoute(runtime: AuthRuntime) {
  return { server: { handlers: { GET: runtime.startSignIn } } };
}

export function callbackRoute(runtime: AuthRuntime) {
  return { server: { handlers: { GET: runtime.completeSignIn } } };
}

export function signOutRoute(runtime: AuthRuntime) {
  return { server: { handlers: { GET: runtime.endSession } } };
}

// POST, unlike the three above. Both email routes receive a form and act on it, and a GET that
// sends an email or spends a one-time code is a GET a prefetcher can trigger.
export function emailStartRoute(runtime: AuthRuntime) {
  return { server: { handlers: { POST: runtime.sendEmailCode } } };
}

export function emailVerifyRoute(runtime: AuthRuntime) {
  return { server: { handlers: { POST: runtime.verifyEmailCode } } };
}
