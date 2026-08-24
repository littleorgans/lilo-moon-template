import { describe, expect, it } from "vitest";

import { loadAuthConfig } from "../src/config.js";
import { createAuthServices } from "../src/services.js";

const config = loadAuthConfig({
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
  WORKOS_API_KEY: "a-server-only-secret",
  WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
});

describe("createAuthServices", () => {
  it("builds a provider client and a verifier from configuration alone", () => {
    const services = createAuthServices(config);

    expect(typeof services.auth.getAuthorizationUrl).toBe("function");
    expect(typeof services.auth.authenticateWithCode).toBe("function");
    expect(typeof services.verify).toBe("function");
  });

  // The verifier is built from the derived issuer, so a client id and an issuer cannot drift apart.
  // Constructing it also proves the options this package passes are ones the auth package accepts,
  // which is where an `audience` that WorkOS never sets would have been rejected.
  it("produces a working authorization url through the real provider client", () => {
    const { auth } = createAuthServices(config);
    const url = new URL(
      auth.getAuthorizationUrl({
        redirectUri: config.redirectUri,
        state: "csrf-token",
        provider: "GoogleOAuth",
      }),
    );

    expect(url.host).toBe("api.workos.com");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("state")).toBe("csrf-token");
  });
});
