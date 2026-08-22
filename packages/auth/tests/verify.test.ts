import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthFailure } from "../src/index.js";
import { AuthError, createVerifier } from "../src/index.js";

const issuer = "https://api.workos.com/user_management/client_01M0JSGENAGWJCN0R7JME8JWGM";
const audience = "client_01M0JSGENAGWJCN0R7JME8JWGM";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signingKey: PrivateKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let otherSigningKey: PrivateKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "ES256" };
  otherSigningKey = (await generateKeyPair("ES256", { extractable: true })).privateKey;
});

interface TokenOptions {
  readonly key?: PrivateKey;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
  readonly claims?: Record<string, unknown>;
}

async function token(options: TokenOptions = {}): Promise<string> {
  return await new SignJWT({
    sub: "user_01HBEQKA6K4QJAS93VPE39W1JT",
    ...options.claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.key ?? signingKey);
}

const verifier = () => createVerifier({ jwks: { keys: [publicJwk] }, issuer, audience });

async function reasonFor(promise: Promise<unknown>): Promise<AuthFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthError) return error.reason;
    throw error;
  }
  throw new Error("Expected verification to fail, but it resolved.");
}

describe("createVerifier", () => {
  it("returns a Principal for a token the issuer signed", async () => {
    const principal = await verifier()(
      await token({ claims: { org_id: "org_01M0", entitlements: ["cubicell:pro"] } }),
    );
    expect(principal.userId).toBe("user_01HBEQKA6K4QJAS93VPE39W1JT");
    expect(principal.orgId).toBe("org_01M0");
    expect(principal.entitlements).toStrictEqual(["cubicell:pro"]);
  });

  // Each of the four below is a distinct decision for the caller: refresh, reject, or alert.
  it("reports an expired token as expired, so a caller can refresh", async () => {
    expect(await reasonFor(verifier()(await token({ expiresIn: "-1m" })))).toBe("expired");
  });

  it("rejects a token from a different issuer", async () => {
    expect(await reasonFor(verifier()(await token({ issuer: "https://evil.example" })))).toBe(
      "issuer",
    );
  });

  it("rejects a token minted for a different audience", async () => {
    expect(await reasonFor(verifier()(await token({ audience: "client_other" })))).toBe("audience");
  });

  // The one that matters: a well-formed token whose signature we cannot attribute to the issuer.
  it("rejects a token signed by a key outside the JWKS", async () => {
    expect(await reasonFor(verifier()(await token({ key: otherSigningKey })))).toBe("signature");
  });

  it.each([["not-a-jwt"], [""], ["a.b.c"]])("rejects %o as malformed", async (value) => {
    expect(await reasonFor(verifier()(value))).toBe("malformed");
  });

  // Verification proves the provider issued the token. It does not prove the token is usable.
  it("separates a valid signature from unusable claims", async () => {
    expect(await reasonFor(verifier()(await token({ claims: { sub: undefined } })))).toBe("claims");
  });

  it("accepts a token inside the clock tolerance", async () => {
    const tolerant = createVerifier({
      jwks: { keys: [publicJwk] },
      issuer,
      audience,
      clockToleranceSeconds: 120,
    });
    await expect(tolerant(await token({ expiresIn: "-30s" }))).resolves.toMatchObject({
      userId: "user_01HBEQKA6K4QJAS93VPE39W1JT",
    });
  });

  it("does not require an audience when the provider sets none", async () => {
    const withoutAudience = createVerifier({ jwks: { keys: [publicJwk] }, issuer });
    await expect(withoutAudience(await token())).resolves.toMatchObject({
      userId: "user_01HBEQKA6K4QJAS93VPE39W1JT",
    });
  });
});
