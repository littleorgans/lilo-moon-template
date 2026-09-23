import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

import type { CookieJar } from "./cookies.js";

/**
 * What the session cookie holds, and deliberately all it holds.
 *
 * No Principal, no email, no organization name. Those are derived by verifying the access token on
 * every request. Role changes take effect when the access token is renewed. Copying them
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

/**
 * The keys a session cookie is sealed and opened with.
 *
 * Two fields rather than one list, so which key seals is a matter of type rather than of position:
 * `seal` takes one key and every writer passes `cookieKey`, so a previous key has no path into a
 * cookie written today.
 */
export interface CookieKeys {
  /** Seals every cookie written, and is the first key tried when opening one. */
  readonly cookieKey: Buffer;
  /** Retired keys, tried in order after `cookieKey` and only when opening. Defaults to none. */
  readonly previousCookieKeys?: readonly Buffer[];
}

/**
 * Opens a cookie with the current key, then each previous key in turn.
 *
 * Trial decryption rather than a key id in the sealed value. A key id would change the format, so a
 * cookie written by this version could not be opened by the one it replaces, and a rolling deploy
 * would sign out whoever a new instance had just written a cookie for. The trials cost at most one
 * AES-GCM tag check per key over a few hundred bytes, microseconds beside the signature check every
 * request already makes, and the previous list is empty outside a rotation. A cookie that no key
 * opens is exactly what a tampered one is: not a session.
 */
function unsealWithAny(keys: CookieKeys, sealed: string): unknown {
  for (const key of [keys.cookieKey, ...(keys.previousCookieKeys ?? [])]) {
    const value = unseal(key, sealed);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Opens a sealed session, returning null unless both tokens are present and non-empty.
 *
 * A session opened with a previous key is not rewritten here. It moves to the current key the next
 * time the tokens change, which for an access token that lives 300 seconds is within five minutes
 * of use: every write already seals with `cookieKey`. Rewriting it now would put the same tokens
 * back in the browser, and a response doing that can land after a concurrent request's refresh and
 * replace the rotated pair with the spent one, which ends the session at its next refresh.
 */
export function readSession(keys: CookieKeys, sealed: string | undefined): Session | null {
  if (sealed === undefined) return null;
  const value = unsealWithAny(keys, sealed);
  const accessToken = readString(value, "accessToken");
  const refreshToken = readString(value, "refreshToken");
  if (accessToken === null || refreshToken === null) return null;
  return { accessToken, refreshToken };
}

export interface SessionCookieDeps extends CookieKeys {
  readonly secureCookies: boolean;
}

/**
 * A year: how long the browser keeps the envelope, not how long the session lasts. The refresh token
 * inside stops working when the WorkOS session ends, which is set in the dashboard and defaults to
 * seven days, so the cookie normally outlives what it holds.
 */
const SESSION_MAX_AGE_SECONDS = 31_536_000;

/**
 * Seals a session into the cookie.
 *
 * Every path that ends holding tokens writes them through here: the OAuth callback, the email code
 * verification, and a silent refresh mid-request. One writer means one set of cookie attributes,
 * and the attributes are the security boundary.
 */
export function writeSession(jar: CookieJar, deps: SessionCookieDeps, session: Session): void {
  jar.write(
    SESSION_COOKIE,
    seal(deps.cookieKey, { accessToken: session.accessToken, refreshToken: session.refreshToken }),
    {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );
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
