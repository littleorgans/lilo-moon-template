/**
 * Why a token was rejected, as a value a caller can branch on.
 *
 * Callers must be able to tell "refresh and retry" from "reject this request" without importing
 * the JWT library or matching on message text. That distinction is the whole reason this package
 * exists as a seam: a second language implementing the same contract reproduces these reasons, not
 * the library that produced them.
 */
export type AuthFailure = "malformed" | "signature" | "expired" | "issuer" | "audience" | "claims";

export class AuthError extends Error {
  readonly reason: AuthFailure;

  constructor(reason: AuthFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
    this.reason = reason;
  }
}
