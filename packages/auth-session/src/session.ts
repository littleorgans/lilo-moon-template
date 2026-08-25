import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

import type { CookieJar } from "./cookies.js";

/**
 * What the session cookie holds, and deliberately all it holds.
 *
 * No Principal, no email, no organization name. Those are derived by verifying the access token on
 * every request, so a cookie minted before a role changed cannot outlive the change. Copying them
 * in here would recreate, in the browser, the same staleness the schema refuses to store.
 */
export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export const SESSION_COOKIE = "lilo_session";
export const STATE_COOKIE = "lilo_oauth_state";
/** The address a code was sent to, held server-readable only, never in a URL. */
export const EMAIL_COOKIE = "lilo_email";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts a value so the browser holds it without being able to read or alter it.
 *
 * AES-256-GCM, so tampering fails authentication rather than decrypting to something else. Node's
 * own crypto rather than a sealing library: the whole operation is twenty lines, and a dependency
 * here would be one more thing on the supply-chain gate for no gain.
 */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Reverses `seal`, returning null for anything that is not exactly what we sealed.
 *
 * Every failure returns null rather than throwing, and none of them says which failure it was. A
 * cookie that fails to open is not a distinguishable set of cases to the caller: it is simply not a
 * session, and the answer in all of them is to sign in again.
 */
export function unseal(key: Buffer, sealed: string): unknown {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const body = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const property: unknown = Reflect.get(value, key);
  return typeof property === "string" && property.length > 0 ? property : null;
}

/** Opens a sealed session, returning null unless both tokens are present and non-empty. */
export function readSession(key: Buffer, sealed: string | undefined): Session | null {
  if (sealed === undefined) return null;
  const value = unseal(key, sealed);
  const accessToken = readString(value, "accessToken");
  const refreshToken = readString(value, "refreshToken");
  if (accessToken === null || refreshToken === null) return null;
  return { accessToken, refreshToken };
}

export interface SessionCookieDeps {
  readonly cookieKey: Buffer;
  readonly secureCookies: boolean;
}

/** A year. The refresh token inside outlives it; this is how long the browser keeps the envelope. */
const SESSION_MAX_AGE_SECONDS = 31_536_000;

/**
 * Seals a session into the cookie.
 *
 * Every path that ends holding tokens writes them through here: the OAuth callback, the email code
 * verification, and a silent refresh mid-request. One writer means one set of cookie attributes,
 * and the attributes are the security boundary.
 */
export function writeSession(jar: CookieJar, deps: SessionCookieDeps, session: Session): void {
  jar.write(SESSION_COOKIE, seal(deps.cookieKey, session), {
    httpOnly: true,
    secure: deps.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** An unguessable value for the OAuth `state` parameter. */
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Compares the returned `state` with the one we issued, in constant time.
 *
 * A plain `===` leaks how many leading characters matched through its timing. That is a thin
 * channel, and closing it costs one function call, so there is no argument for leaving it open.
 */
export function stateMatches(expected: string | undefined, returned: string | null): boolean {
  if (expected === undefined || returned === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(returned);
  // timingSafeEqual throws on a length mismatch, which would itself be a signal. Length is not
  // secret here, so checking it first is safe and keeps the comparison total.
  return a.length === b.length && timingSafeEqual(a, b);
}
