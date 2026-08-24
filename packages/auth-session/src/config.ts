import { hkdfSync } from "node:crypto";

/**
 * Everything the identity half needs, read from the environment exactly once.
 *
 * Nothing under `packages/` reads `process.env`. Those packages take configuration as arguments so
 * a secret cannot be picked up implicitly by a library, which is what keeps them testable and
 * portable. The application is the only layer allowed to know that an environment exists, and this
 * file is the only part of the application that does.
 */
export interface AuthConfig {
  readonly clientId: string;
  readonly apiKey: string;
  readonly redirectUri: string;
  /** Derived from the cookie password, never the password itself. */
  readonly cookieKey: Buffer;
  /** Derived from the client id rather than configured, so the two cannot disagree. */
  readonly issuer: string;
  readonly jwksUri: string;
  /** A `Secure` cookie is dropped by browsers over plain http, which localhost is. */
  readonly secureCookies: boolean;
}

// 32 characters of a high-entropy password is the floor `.env.example` documents. Shorter values
// are refused rather than stretched: stretching a weak password here would hide the weakness.
const MINIMUM_COOKIE_PASSWORD = 32;

type RequiredNames =
  | "WORKOS_CLIENT_ID"
  | "WORKOS_API_KEY"
  | "WORKOS_REDIRECT_URI"
  | "WORKOS_COOKIE_PASSWORD";

/**
 * Proves every required value is present, naming all the missing ones at once.
 *
 * An assertion function rather than a cast or a lookup returning `string | undefined`. Both of
 * those force callers into a `?? ""` fallback that can never run, and an unreachable branch is a
 * small lie in a coverage report as well as dead code.
 */
function assertComplete(
  values: Readonly<Record<RequiredNames, string | undefined>>,
): asserts values is Readonly<Record<RequiredNames, string>> {
  const missing = Object.entries(values)
    .filter(([, value]) => value === undefined || value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment: ${missing.join(", ")}. Copy .env.example to .env.local and fill it in.`,
    );
  }
}

/**
 * Turns the cookie password into a key.
 *
 * HKDF rather than scrypt because this runs once per process and the input is already required to
 * be high entropy, so the deliberate slowness of a password hash buys nothing. The `info` string
 * binds the key to this one use: the same password used for another purpose derives a different
 * key, so a value sealed for one cannot be unsealed by the other.
 */
function cookieKeyFrom(password: string): Buffer {
  if (password.length < MINIMUM_COOKIE_PASSWORD) {
    throw new Error(
      `WORKOS_COOKIE_PASSWORD must be at least ${MINIMUM_COOKIE_PASSWORD} characters, got ${password.length}.`,
    );
  }
  return Buffer.from(hkdfSync("sha256", password, "lilo-moon-session", "session-cookie-v1", 32));
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const values: Readonly<Record<RequiredNames, string | undefined>> = {
    WORKOS_CLIENT_ID: env["WORKOS_CLIENT_ID"],
    WORKOS_API_KEY: env["WORKOS_API_KEY"],
    WORKOS_REDIRECT_URI: env["WORKOS_REDIRECT_URI"],
    WORKOS_COOKIE_PASSWORD: env["WORKOS_COOKIE_PASSWORD"],
  };
  assertComplete(values);

  const clientId = values.WORKOS_CLIENT_ID;
  const redirectUri = values.WORKOS_REDIRECT_URI;

  return {
    clientId,
    apiKey: values.WORKOS_API_KEY,
    redirectUri,
    cookieKey: cookieKeyFrom(values.WORKOS_COOKIE_PASSWORD),
    issuer: `https://api.workos.com/user_management/${clientId}`,
    jwksUri: `https://api.workos.com/sso/jwks/${clientId}`,
    // A Secure cookie is silently dropped over plain http, which localhost is.
    secureCookies: !redirectUri.startsWith("http://"),
  };
}
