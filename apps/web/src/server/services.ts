import { createVerifier } from "@lilo-moon/auth";
import type { Verifier } from "@lilo-moon/auth";
import { createWorkOSAuth } from "@lilo-moon/auth-workos";
import type { WorkOSAuth } from "@lilo-moon/auth-workos";
import { createDatabase } from "@lilo-moon/db";
import type { Database } from "@lilo-moon/db";

import { loadConfig } from "./config.js";
import type { WebConfig } from "./config.js";

/**
 * The three packages, composed once per process.
 *
 * Built lazily rather than at module load so importing a route in a test does not demand a filled
 * `.env.local`. Held per process rather than per request because each one owns something worth
 * keeping: a JWKS key set that would otherwise be refetched, and a Postgres connection pool.
 */
interface Services {
  readonly config: WebConfig;
  readonly auth: WorkOSAuth;
  readonly verify: Verifier;
  /** Null when DATABASE_URL is unset, which is a runnable state: sign-in works without Postgres. */
  readonly database: Database | null;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services !== null) return services;
  const config = loadConfig();
  services = {
    config,
    auth: createWorkOSAuth({ apiKey: config.apiKey, clientId: config.clientId }),
    // No `audience`. WorkOS access tokens carry `client_id`, not `aud`, measured against the live
    // environment and recorded in docs/decisions.md. jose rejects a token whose `aud` is absent
    // when an audience is expected, so setting it here would refuse every token we are issued.
    // The issuer is already client-id specific, so it pins the token to this application anyway.
    verify: createVerifier({
      jwks: { uri: config.jwksUri },
      issuer: config.issuer,
    }),
    database:
      config.databaseUrl === null ? null : createDatabase({ connectionString: config.databaseUrl }),
  };
  return services;
}
