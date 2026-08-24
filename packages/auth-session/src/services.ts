import { createVerifier } from "@lilo-moon/auth";
import type { Verifier } from "@lilo-moon/auth";
import { createWorkOSAuth } from "@lilo-moon/auth-workos";
import type { WorkOSAuth } from "@lilo-moon/auth-workos";

import type { AuthConfig } from "./config.js";

export interface AuthServices {
  readonly auth: WorkOSAuth;
  readonly verify: Verifier;
}

/**
 * Builds the provider client and the token verifier from configuration.
 *
 * No `audience` is set. WorkOS access tokens carry `client_id` rather than `aud`, measured against
 * the live environment and recorded in docs/decisions.md, and jose rejects a token whose `aud` is
 * absent when an audience is expected. Setting it would refuse every token the provider issues.
 * The issuer is already client-id specific, so it pins the token to this application regardless.
 */
export function createAuthServices(config: AuthConfig): AuthServices {
  return {
    auth: createWorkOSAuth({ apiKey: config.apiKey, clientId: config.clientId }),
    verify: createVerifier({ jwks: { uri: config.jwksUri }, issuer: config.issuer }),
  };
}
