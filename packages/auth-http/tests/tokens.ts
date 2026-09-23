import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { JWK } from "jose";

export const issuer = "https://issuer.example/user_management/client_TEST";
export const userId = "user_01HBEQKA6K4QJAS93VPE39W1JT";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

export interface Signer {
  /** The public half, as a JWKS entry. */
  readonly jwk: JWK;
  sign(options?: {
    readonly expiresIn?: string;
    readonly claims?: Record<string, unknown>;
  }): Promise<string>;
}

/** A fresh ES256 key pair that signs access tokens for `issuer`. */
export async function createSigner(): Promise<Signer> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const key: PrivateKey = pair.privateKey;
  return {
    jwk: { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "ES256" },
    async sign(options = {}) {
      return await new SignJWT({ sub: userId, ...options.claims })
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuedAt()
        .setIssuer(issuer)
        .setExpirationTime(options.expiresIn ?? "5m")
        .sign(key);
    },
  };
}
