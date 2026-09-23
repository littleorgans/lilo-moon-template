import type { VerifierOptions } from "@littleorgans/auth";

/**
 * What a bearer-token service reads from its environment.
 *
 * A service needs none of the web session's settings: no API key, redirect URI or cookie
 * password. The client id alone pins the issuer and the key set.
 */
export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly workosClientId: string;
  /** Pass to `createVerifier` from `@littleorgans/auth`. Derived from the client id. */
  readonly verifier: VerifierOptions;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Every problem with the environment, found in one pass. `problems` names variables and the rule
 * each one broke. No entry contains a value: a malformed DATABASE_URL still holds a password.
 */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid service environment:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Reading<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

// `parse` returns undefined for a value it rejects, and the problem is written from `rule` alone.
// That is what keeps values out of messages: no parser has a way to put one there.
function read<T>(
  env: Environment,
  name: string,
  rule: string,
  parse: (raw: string) => T | undefined,
): Reading<T> {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) return { ok: false, problem: `${name} is missing` };
  const value = parse(raw);
  return value === undefined ? { ok: false, problem: `${name} ${rule}` } : { ok: true, value };
}

function parsePort(raw: string): number | undefined {
  if (!/^\d{1,5}$/.test(raw)) return undefined;
  const port = Number(raw);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

function parseDatabaseUrl(raw: string): string | undefined {
  const url = URL.parse(raw);
  return url !== null && (url.protocol === "postgres:" || url.protocol === "postgresql:")
    ? raw
    : undefined;
}

// The id is interpolated into the issuer and JWKS URLs, so anything outside WorkOS's own alphabet
// is refused rather than escaped into a path segment.
function parseClientId(raw: string): string | undefined {
  return /^client_[0-9A-Za-z]+$/.test(raw) ? raw : undefined;
}

/**
 * Reads and validates a service's environment, reporting every missing or invalid variable at
 * once in a thrown `ConfigError`.
 *
 * The same shape as `loadAuthConfig` in `@littleorgans/auth-session`: `process.env` is read only as
 * the default argument, and tests pass their own environment.
 *
 * The verifier options set no audience, for the reason `createAuthServices` in `auth-session`
 * records: WorkOS access tokens carry `client_id` rather than `aud`. The client-specific issuer
 * pins the token to this application instead.
 */
export function loadServiceConfig(env: Environment = process.env): ServiceConfig {
  const port = read(env, "PORT", "must be an integer from 1 to 65535", parsePort);
  const databaseUrl = read(
    env,
    "DATABASE_URL",
    "must be a postgres:// or postgresql:// URL",
    parseDatabaseUrl,
  );
  const clientId = read(
    env,
    "WORKOS_CLIENT_ID",
    "must look like client_ followed by letters and digits",
    parseClientId,
  );

  if (!port.ok || !databaseUrl.ok || !clientId.ok) {
    throw new ConfigError(
      [port, databaseUrl, clientId].flatMap((reading) => (reading.ok ? [] : [reading.problem])),
    );
  }

  return {
    port: port.value,
    databaseUrl: databaseUrl.value,
    workosClientId: clientId.value,
    verifier: {
      issuer: `https://api.workos.com/user_management/${clientId.value}`,
      jwks: { uri: `https://api.workos.com/sso/jwks/${clientId.value}` },
    },
  };
}
