import { createVerifier } from "@littleorgans/auth";
import type { Verifier } from "@littleorgans/auth";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { JWK } from "jose";
import { vi } from "vitest";

export const issuer = "https://issuer.example/user_management/client_TEST";

/** The instant every token test runs at, in epoch seconds. Whole, so `exp - NOW` is exact. */
export const NOW = 1_800_000_000;

/** Stops `Date` at `NOW`, for jose's expiry check and the refresh margin alike. Timers still run. */
export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

export interface Signer {
  /** The public half, as a JWKS entry. */
  readonly jwk: JWK;
  /** A token expiring `secondsLeft` after `NOW`, or with no `exp` at all when that is null. */
  sign(secondsLeft: number | null, claims?: Record<string, unknown>): Promise<string>;
}

/**
 * A fresh ES256 key pair that signs access tokens for `issuer` as the provider would.
 *
 * Every signer uses the same `kid`, so a token from one the verifier does not trust is matched to
 * the trusted key and fails on its signature: a forgery, rather than an unknown key.
 */
export async function createSigner(): Promise<Signer> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const key: PrivateKey = pair.privateKey;
  return {
    jwk: { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "ES256" },
    async sign(secondsLeft, claims = {}) {
      const token = new SignJWT({ sub: "user_01HBEQ", org_id: "org_01M0", ...claims })
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuer(issuer);
      if (secondsLeft !== null) token.setExpirationTime(NOW + secondsLeft);
      return await token.sign(key);
    },
  };
}

/** The real verifier, trusting `signer` alone, with its default five seconds of clock tolerance. */
export function verifierFor(signer: Signer): Verifier {
  return createVerifier({ jwks: { keys: [signer.jwk] }, issuer });
}
