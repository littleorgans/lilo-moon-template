import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey, JWTVerifyOptions } from "jose";

import { AuthError } from "./errors.js";
import { toPrincipal } from "./principal.js";
import type { Principal } from "./principal.js";

/**
 * One public key, as it appears in a JWKS document. Described here rather than imported so the
 * package's public API stays plain JSON and callers never reference a JWT library type.
 */
export interface JsonWebKey {
  readonly kty?: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly [parameter: string]: unknown;
}

/**
 * Where public keys come from. A URI is the normal case; inline keys exist so tests, and a second
 * language port, can exercise verification without a network.
 */
export type JwksSource = { readonly uri: string } | { readonly keys: readonly JsonWebKey[] };

export interface VerifierOptions {
  readonly jwks: JwksSource;
  /** Rejected unless the token's `iss` matches exactly. */
  readonly issuer: string;
  /** Usually the OAuth client id. Omit only if the provider does not set `aud`. */
  readonly audience?: string;
  /** Allowance for clock skew between us and the provider. Defaults to 5 seconds. */
  readonly clockToleranceSeconds?: number;
}

export type Verifier = (token: string) => Promise<Principal>;

// Read a property off an unknown thrown value without asserting its shape. Reflect.get keeps this
// honest where a cast would let a wrong guess past the type checker.
function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property: unknown = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

// jose reports failures as codes on the error. Mapping them here is what keeps `jose` out of every
// caller's error handling, and keeps AuthFailure a contract another language can reimplement.
function translate(error: unknown): AuthError {
  const message = error instanceof Error ? error.message : String(error);
  switch (stringProperty(error, "code")) {
    case "ERR_JWT_EXPIRED":
      return new AuthError("expired", message, { cause: error });
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
    case "ERR_JWKS_TIMEOUT":
      return new AuthError("signature", message, { cause: error });
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim = stringProperty(error, "claim");
      if (claim === "iss") return new AuthError("issuer", message, { cause: error });
      if (claim === "aud") return new AuthError("audience", message, { cause: error });
      return new AuthError("claims", message, { cause: error });
    }
    default:
      return new AuthError("malformed", message, { cause: error });
  }
}

function keySetFor(jwks: JwksSource): JWTVerifyGetKey {
  if ("uri" in jwks) return createRemoteJWKSet(new URL(jwks.uri));
  return createLocalJWKSet({ keys: jwks.keys.map((key) => ({ ...key })) });
}

/**
 * Builds a verifier bound to one issuer.
 *
 * The key set is resolved once, at construction, because a remote JWKS caches keys and rate limits
 * refetches. Building it per call would defeat both and put the provider's JWKS endpoint on the
 * request path of every authenticated request.
 *
 * There is no provider SDK here and there must not be. The inputs are a URL, an issuer and an
 * audience, which is all any compliant provider needs, and it is what makes the same contract
 * implementable in another language against the same tokens.
 */
export function createVerifier(options: VerifierOptions): Verifier {
  const keys = keySetFor(options.jwks);
  // Built conditionally rather than passing undefined: exactOptionalPropertyTypes distinguishes an
  // absent audience from one explicitly set to undefined, and jose accepts only the former.
  const verifyOptions: JWTVerifyOptions = {
    issuer: options.issuer,
    clockTolerance: options.clockToleranceSeconds ?? 5,
    ...(options.audience === undefined ? {} : { audience: options.audience }),
  };

  return async function verify(token: string): Promise<Principal> {
    let claims: Record<string, unknown>;
    try {
      const result = await jwtVerify(token, keys, verifyOptions);
      claims = result.payload;
    } catch (error) {
      throw translate(error);
    }
    // Outside the catch on purpose: a claim-shape failure is ours, and wrapping it again would
    // relabel it with whatever the last jose code happened to be.
    return toPrincipal(claims);
  };
}
