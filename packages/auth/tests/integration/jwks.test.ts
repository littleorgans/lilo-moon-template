import { createServer } from "node:http";

import { SignJWT, generateKeyPair } from "jose";
import { expect, it } from "vitest";

import { createVerifier } from "../../src/verify.js";

it("reports a failed JWKS HTTP request as unavailable rather than an invalid token", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503);
    response.end("temporarily unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
    const { privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT({ sub: "user_test" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://issuer.example")
      .setExpirationTime("5m")
      .sign(privateKey);
    const verify = createVerifier({
      issuer: "https://issuer.example",
      jwks: { uri: `http://127.0.0.1:${address.port}/jwks` },
    });
    await expect(verify(token)).rejects.toMatchObject({ reason: "unavailable" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
