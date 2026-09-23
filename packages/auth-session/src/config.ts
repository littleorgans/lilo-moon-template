import { createHash, hkdfSync } from "node:crypto";

/**
 * Everything the identity half needs, read from the environment exactly once.
 *
 * This file is the only place under `packages/` that touches `process.env`, and only as the
 * default argument of `loadAuthConfig`. Every other module takes configuration as arguments so a
 * secret cannot be picked up implicitly by a library, which is what keeps them testable and
 * portable. Tests and applications override the default by passing their own environment.
 */
export interface AuthConfig {
  readonly clientId: string;
  readonly cookieNamespace: string;
  readonly apiKey: string;
  readonly redirectUri: string;
  /** Derived from the cookie password, never the password itself. Seals every cookie written. */
  readonly cookieKey: Buffer;
  /**
   * Derived from `WORKOS_COOKIE_PASSWORD_PREVIOUS`, in the order listed, and empty when it is unset.
   * Only ever tried when opening a cookie, after `cookieKey`, so a rotation signs nobody out.
   */
  readonly previousCookieKeys: readonly Buffer[];
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
function cookieKeyFrom(name: string, password: string): Buffer {
  if (password.length < MINIMUM_COOKIE_PASSWORD) {
    throw new Error(
      `${name} must be at least ${MINIMUM_COOKIE_PASSWORD} characters, got ${password.length}.`,
    );
  }
  return Buffer.from(hkdfSync("sha256", password, "lilo-moon-session", "session-cookie-v1", 32));
}

/**
 * Turns the retired passwords into keys that open cookies and never seal one.
 *
 * A comma-separated list rather than one variable per key, so a rotation that overlaps another
 * needs no new name. Whitespace around each entry is dropped so `a, b` means what it looks like,
 * which means a password listed here can hold neither a comma nor surrounding whitespace;
 * `openssl rand -base64 32` prints neither. Unset or empty means no previous keys, which is every
 * deployment that has never rotated.
 *
 * Each password meets the same floor as the current one, and none may repeat another: a duplicate
 * is harmless to the cipher but almost always means a rotation was half done, such as a new
 * password left in both variables. The errors name the entry by position and never its value.
 */
function previousCookieKeysFrom(current: string, list: string | undefined): Buffer[] {
  if (list === undefined || list.trim().length === 0) return [];
  const name = "WORKOS_COOKIE_PASSWORD_PREVIOUS";
  const passwords = list.split(",").map((entry) => entry.trim());
  const seen = new Set([current]);
  return passwords.map((password, index) => {
    const entry = `${name} entry ${index + 1}`;
    if (password.length === 0) throw new Error(`${entry} is empty. Remove the extra comma.`);
    if (password === current) {
      throw new Error(
        `${entry} is the same as WORKOS_COOKIE_PASSWORD. A key is current or previous, not both.`,
      );
    }
    if (seen.has(password)) throw new Error(`${entry} repeats an earlier entry.`);
    seen.add(password);
    return cookieKeyFrom(entry, password);
  });
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
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== "https:" &&
    !(
      redirect.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname)
    )
  ) {
    throw new Error("WORKOS_REDIRECT_URI must use HTTPS except on localhost.");
  }

  return {
    clientId,
    cookieNamespace: createHash("sha256")
      .update(`${clientId}:${redirect.href}`)
      .digest("hex")
      .slice(0, 16),
    apiKey: values.WORKOS_API_KEY,
    redirectUri,
    cookieKey: cookieKeyFrom("WORKOS_COOKIE_PASSWORD", values.WORKOS_COOKIE_PASSWORD),
    previousCookieKeys: previousCookieKeysFrom(
      values.WORKOS_COOKIE_PASSWORD,
      env["WORKOS_COOKIE_PASSWORD_PREVIOUS"],
    ),
    issuer: `https://api.workos.com/user_management/${clientId}`,
    jwksUri: `https://api.workos.com/sso/jwks/${clientId}`,
    // A Secure cookie is silently dropped over plain http, which localhost is.
    secureCookies: redirect.protocol === "https:",
  };
}
