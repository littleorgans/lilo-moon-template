import { createAuthRuntime } from "@littleorgans/auth-tanstack";

// Application choices stay here; the package owns the session mechanics.
export const auth = createAuthRuntime({
  provider: "GoogleOAuth",
  signedInPath: "/app",
  organizationPolicy: "personal",
  codeEntryPath: "/verify-email",
});
