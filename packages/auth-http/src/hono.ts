import type { Principal } from "@littleorgans/auth";
import type { MiddlewareHandler } from "hono";

import { createAuthenticator, rejectionResponse } from "./authenticate.js";
import type { AuthenticatorOptions } from "./authenticate.js";

/**
 * The Hono environment a protected route runs in. Type the app or route with it and read the
 * caller through `c.var.principal`, which is set on every request that reaches the handler.
 */
export interface AuthEnv {
  Variables: { principal: Principal };
}

/**
 * Hono middleware over the Fetch core. Hono already holds a standard `Request`, so the adapter is
 * only wiring: it returns the core's response for a rejection and stores the Principal otherwise.
 * A second adapter repeats these few lines for its own framework and shares everything else.
 */
export function requireAuth(options: AuthenticatorOptions): MiddlewareHandler<AuthEnv> {
  const authenticate = createAuthenticator(options);
  return async (c, next) => {
    const result = await authenticate(c.req.raw);
    if (!result.ok) return rejectionResponse(result.rejection);
    c.set("principal", result.principal);
    return next();
  };
}
