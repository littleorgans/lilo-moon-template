import { createAuthServices, loadAuthConfig } from "@lilo-moon/auth-session";
import type { AuthConfig, AuthServices } from "@lilo-moon/auth-session";
import { createDatabase } from "@lilo-moon/db";
import type { Database } from "@lilo-moon/db";

/**
 * The composition root, held per process.
 *
 * Built lazily rather than at module load, so importing a route in a test does not demand a filled
 * `.env.local`. Held per process rather than per request because each part owns something worth
 * keeping: a JWKS key set that would otherwise be refetched, and a Postgres connection pool.
 *
 * This stays in the application on purpose. It is the one file that decides which pieces this
 * product runs with, and a second application is entitled to a different answer.
 */
interface Services extends AuthServices {
  readonly config: AuthConfig;
  /** Null when DATABASE_URL is unset, which is a runnable state: sign-in works without Postgres. */
  readonly database: Database | null;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services !== null) return services;
  const config = loadAuthConfig();
  const databaseUrl = process.env["DATABASE_URL"];
  services = {
    config,
    ...createAuthServices(config),
    database:
      databaseUrl === undefined || databaseUrl.length === 0
        ? null
        : createDatabase({ connectionString: databaseUrl }),
  };
  return services;
}
