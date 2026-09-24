import { loadServiceConfig } from "@littleorgans/auth-http";
import { createAuthServices, loadAuthConfig } from "@littleorgans/auth-session";
import type { AuthConfig, AuthServices } from "@littleorgans/auth-session";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuthFailure } from "@littleorgans/auth-workos";
import { WorkOS } from "@workos-inc/node";
import { decodeJwt } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  CODE_LIFETIME_SECONDS,
  REUSE_NEEDED_SECONDS,
} from "../src/assumptions.js";
import {
  contractEmail,
  personalExternalId,
  removeUsers,
  requiredCredentials,
  stagingCredentials,
  sweepStale,
} from "../src/staging.js";

// Each test below is one provider behaviour a package depends on, named for it, in the order a
// sign-in meets them. They share one user and run in sequence: a later one starts from the session
// an earlier one produced, as the application does.

// contract/global-setup.ts says why when this is null.
const credentials = stagingCredentials();

async function rejection(promise: Promise<unknown>): Promise<WorkOSAuthError> {
  const error: unknown = await promise.then(
    () => new Error("expected the provider to refuse"),
    (caught: unknown) => caught,
  );
  if (!(error instanceof WorkOSAuthError)) throw error;
  return error;
}

async function reasonOf(promise: Promise<unknown>): Promise<WorkOSAuthFailure> {
  return (await rejection(promise)).reason;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(credentials === null)("WorkOS staging, as the auth packages use it", () => {
  let clientId = "";
  let config: AuthConfig;
  let services: AuthServices;
  // The raw SDK, for what the packages never do: read the code the provider mints, end a session
  // from the outside, and clean up.
  let admin: WorkOS;
  const email = contractEmail("api");
  const created = new Set<string>();
  let userId = "";
  let signedIn: Authentication;
  let organizationId = "";

  // Built here rather than in the describe body, which runs even when the suite is skipped.
  beforeAll(async () => {
    const staging = requiredCredentials();
    clientId = staging.clientId;
    // The application's own wiring, so the issuer, JWKS URI and verifier are the ones it uses.
    config = loadAuthConfig({
      WORKOS_API_KEY: staging.apiKey,
      WORKOS_CLIENT_ID: clientId,
      WORKOS_REDIRECT_URI: "http://localhost:5199/callback",
      WORKOS_COOKIE_PASSWORD: "contract-tests-never-seal-a-cookie-with-this",
    });
    services = createAuthServices(config);
    admin = new WorkOS({ apiKey: staging.apiKey, clientId });
    await sweepStale(admin);
  });

  afterAll(async () => {
    // Empty unless beforeAll got as far as the provider.
    if (created.size > 0) await removeUsers(admin, created);
  });

  it("publishes the issuer and JWKS URI both packages derive from the client id", async () => {
    const response = await fetch(`${config.issuer}/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    const discovery: unknown = await response.json();
    expect(discovery).toMatchObject({ issuer: config.issuer, jwks_uri: config.jwksUri });

    // auth-http refuses a client id outside WorkOS's alphabet, and derives the same two values.
    const service = loadServiceConfig({
      PORT: "3000",
      DATABASE_URL: "postgres://contract@localhost/contract",
      WORKOS_CLIENT_ID: clientId,
    });
    expect(service.verifier.issuer).toBe(config.issuer);
    expect(service.verifier.jwks).toEqual({ uri: config.jwksUri });
  });

  it("creates the user for a new address and mints a six-digit code that lives ten minutes", async () => {
    // email.ts: one flow is both sign-in and sign-up because the provider creates the user.
    const code = await admin.userManagement.createMagicAuth({ email });
    userId = code.userId;
    created.add(userId);

    expect(code.code).toMatch(/^\d{6}$/);
    expect((await admin.userManagement.getUser(userId)).email).toBe(email);
    const lifetime = (Date.parse(code.expiresAt) - Date.parse(code.createdAt)) / 1000;
    expect(Math.round(lifetime)).toBe(CODE_LIFETIME_SECONDS);
  });

  it("refuses a wrong, a superseded and a spent code as code-rejected", async () => {
    // errors.ts matches the `one_time_code` family; code-rejected is the one failure the person can
    // fix, so verify returns them to the code page instead of a failure page.
    const superseded = await admin.userManagement.createMagicAuth({ email });
    const current = await admin.userManagement.createMagicAuth({ email });
    const wrong = current.code === "000000" ? "111111" : "000000";
    const verify = (code: string) => services.auth.verifyMagicAuthCode({ email, code });

    expect(await reasonOf(verify(wrong))).toBe("code-rejected");
    expect(await reasonOf(verify(superseded.code))).toBe("code-rejected");
    signedIn = await verify(current.code);
    expect(await reasonOf(verify(current.code))).toBe("code-rejected");
  });

  it("issues a first token that verifies on issuer and JWKS alone, with no organization and no aud", async () => {
    expect(signedIn.user.id).toBe(userId);
    // ensureOrganization provisions only when the sign-in arrives without one.
    expect(signedIn.organizationId).toBeNull();

    const principal = await services.verify(signedIn.accessToken);
    expect(principal).toMatchObject({ userId, orgId: null });

    // services.ts sets no audience because the token carries client_id instead; signout.ts reads
    // sid to address the provider session.
    const claims = decodeJwt(signedIn.accessToken);
    expect(claims.aud).toBeUndefined();
    expect(claims["client_id"]).toBe(clientId);
    expect(typeof claims["sid"]).toBe("string");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);
  });

  it("answers a repeated provisioning with the organization and membership the first one made", async () => {
    // A taken external_id arrives as a 400 GenericServerException that errors.ts reads as conflict,
    // and provisionOrganization adopts the organization holding it. The membership call repeats too.
    const input = { name: email, userId, externalId: personalExternalId(userId) };
    const first = await services.auth.provisionOrganization(input);
    organizationId = first.organizationId;
    const again = await services.auth.provisionOrganization(input);
    expect(again).toEqual(first);
  });

  it("puts the organization, role, roles and permissions in a token refreshed for it", async () => {
    // Membership does not reach a token already minted, so ensureOrganization refreshes with the id.
    signedIn = await services.auth.refreshTokens({
      refreshToken: signedIn.refreshToken,
      organizationId,
    });
    expect(signedIn.organizationId).toBe(organizationId);

    const principal = await services.verify(signedIn.accessToken);
    expect(principal.orgId).toBe(organizationId);
    expect(principal.roles.length).toBeGreaterThan(0);
    const claims = decodeJwt(signedIn.accessToken);
    expect(typeof claims["role"]).toBe("string");
    expect(Array.isArray(claims["roles"])).toBe(true);
    expect(Array.isArray(claims["permissions"])).toBe(true);
  });

  it("keeps the organization when a refresh names none", async () => {
    // access.ts refreshes an expired session with the refresh token alone.
    signedIn = await services.auth.refreshTokens({ refreshToken: signedIn.refreshToken });
    expect((await services.verify(signedIn.accessToken)).orgId).toBe(organizationId);
  });

  it(`still refreshes with a spent refresh token ${REUSE_NEEDED_SECONDS} seconds after its first use`, async () => {
    // access.ts: a request still carrying the old cookie, here or on another instance, refreshes
    // with the token the winner spent, for up to the early-refresh margin plus the clock tolerance.
    const spent = signedIn.refreshToken;
    const firstUse = Date.now();
    const winner = await services.auth.refreshTokens({ refreshToken: spent });
    const racing = await Promise.all([
      services.auth.refreshTokens({ refreshToken: spent }),
      services.auth.refreshTokens({ refreshToken: spent }),
    ]);

    await sleep(firstUse + (REUSE_NEEDED_SECONDS + 1) * 1000 - Date.now());
    const late = await services.auth.refreshTokens({ refreshToken: spent });

    const principals = await Promise.all(
      [winner, ...racing, late].map((renewed) => services.verify(renewed.accessToken)),
    );
    expect(principals.map((principal) => principal.orgId)).toEqual(
      principals.map(() => organizationId),
    );
    // The pair a late request writes into its cookie must itself be usable.
    signedIn = await services.auth.refreshTokens({ refreshToken: late.refreshToken });
  });

  it("ends the provider session at the logout URL built from sid, after which refresh is refused as unauthorized", async () => {
    const sessionId = decodeJwt(signedIn.accessToken)["sid"];
    if (typeof sessionId !== "string") throw new Error("the token has no sid");
    const logout = services.auth.getLogoutUrl({
      sessionId,
      returnTo: new URL("/", config.redirectUri).href,
    });
    const response = await fetch(logout, { redirect: "manual" });
    expect(response.status).toBe(302);

    const sessions = await admin.userManagement.listSessions(userId);
    expect(
      sessions.data.filter((session) => session.id === sessionId && session.status === "active"),
    ).toEqual([]);
    // access.ts reads unauthorized as ended: clear the cookie and ask the person to sign in again.
    const refused = await rejection(
      services.auth.refreshTokens({ refreshToken: signedIn.refreshToken }),
    );
    expect(refused.reason).toBe("unauthorized");
  });
});
