import { createAuthRuntime } from "@littleorgans/auth-tanstack";
import { getRequestIP } from "@tanstack/react-start/server";

import { memoryThrottle } from "./throttle.js";

// Application choices stay here; the package owns the session mechanics.
export const auth = createAuthRuntime({
  provider: "GoogleOAuth",
  signedInPath: "/app",
  organizationPolicy: "personal",
  codeEntryPath: "/verify-email",
  // One process's memory: replace it before running more than one instance. The socket address is
  // the client only when nothing sits in front of the application; behind a proxy you control, read
  // the forwarded one with `getRequestIP({ xForwardedFor: true })`. See memoryThrottle.
  throttle: memoryThrottle({ clientOf: () => getRequestIP() }),
});
