import { createAuthRuntime } from "@lilo-moon/auth-tanstack";

/**
 * This application's identity runtime.
 *
 * Two decisions, and they are the only two an application makes about signing in: which identity
 * path, and where a completed sign-in lands. Everything else is in the packages.
 *
 * Google only, deliberately. Every social provider wired before a custom AuthKit domain is enabled
 * has to be re-registered with that provider afterwards, so providers are added when they are
 * needed rather than because the type permits them.
 */
export const auth = createAuthRuntime({
  provider: "GoogleOAuth",
  signedInPath: "/app",
});
