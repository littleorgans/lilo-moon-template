import { createAuthRuntime } from "@lilo-moon/auth-tanstack";

/**
 * This application's identity runtime.
 *
 * Three decisions, and they are the only three an application makes about signing in: which
 * redirect identity path, where a completed sign-in lands, and where the emailed code is typed.
 * Everything else is in the packages.
 *
 * Google only, deliberately. Every social provider wired before a custom AuthKit domain is enabled
 * has to be re-registered with that provider afterwards, so providers are added when they are
 * needed rather than because the type permits them. The email-code path needs no such
 * registration, which is why it is the second way in rather than a second provider.
 */
export const auth = createAuthRuntime({
  provider: "GoogleOAuth",
  signedInPath: "/app",
  codeEntryPath: "/verify-email",
});
