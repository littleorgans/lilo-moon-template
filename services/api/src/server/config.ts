import { ConfigError, loadServiceConfig } from "@littleorgans/auth-http";
import type { Environment, ServiceConfig } from "@littleorgans/auth-http";

import type { Log } from "./log.ts";

/**
 * Reads the environment once, at startup. `loadServiceConfig` validates the three variables every
 * service needs: `PORT`, `DATABASE_URL` and `WORKOS_CLIENT_ID`.
 *
 * An invalid environment is an expected way to fail, so it becomes one structured log line and
 * `null`, not a stack trace. The problems name variables and rules, never values, because a
 * malformed `DATABASE_URL` still holds a password. Anything else is a bug and propagates.
 */
export function readConfig(env: Environment, log: Log): ServiceConfig | null {
  try {
    return loadServiceConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log({ level: "error", event: "config_invalid", problems: error.problems });
    return null;
  }
}
