/**
 * The provider's numbers the auth packages are written around, each with the place that assumes it.
 *
 * Only `REFRESH_MARGIN_SECONDS`, `CLOCK_TOLERANCE_SECONDS` and `CODE_LIFETIME_SECONDS` are the
 * packages' own constants. They are not exported by the packages, so they are repeated here and
 * `tests/assumptions.test.ts` reads the package sources to prove the copies still agree.
 */

/** `REFRESH_MARGIN_SECONDS` in packages/auth-session/src/access.ts. */
export const REFRESH_MARGIN_SECONDS = 20;

/** The default `clockToleranceSeconds` in packages/auth/src/verify.ts. */
export const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * How long after its first use a spent refresh token must still refresh.
 *
 * The early refresh spends the token up to the margin before `exp`, and the old access token keeps
 * verifying for the tolerance after it. Every request still carrying the old cookie in that time
 * refreshes with the spent token again (packages/auth-session/src/access.ts, `inFlight` and
 * `REFRESH_MARGIN_SECONDS`). WorkOS documents 30 seconds; the code needs at least this much.
 */
export const REUSE_NEEDED_SECONDS = REFRESH_MARGIN_SECONDS + CLOCK_TOLERANCE_SECONDS;

/** "An access token lives 300 seconds, measured against the live provider" (access.ts). */
export const ACCESS_TOKEN_LIFETIME_SECONDS = 300;

/** `EMAIL_MAX_AGE_SECONDS` in packages/auth-session/src/email.ts: the provider's code lifetime. */
export const CODE_LIFETIME_SECONDS = 600;
