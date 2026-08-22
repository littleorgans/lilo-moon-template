import { UnauthorizedException } from "@workos-inc/node";
import { describe, expect, it } from "vitest";

import type { WorkOSClient, WorkOSAuthError } from "../src/index.js";
import { createWorkOSAuth } from "../src/index.js";

type UserManagement = WorkOSClient["userManagement"];
type MultiFactorAuth = WorkOSClient["multiFactorAuth"];
type Organizations = WorkOSClient["organizations"];

type Call =
  | {
      readonly method: "authenticateWithPassword";
      readonly options: Parameters<UserManagement["authenticateWithPassword"]>[0];
    }
  | {
      readonly method: "createMagicAuth";
      readonly options: Parameters<UserManagement["createMagicAuth"]>[0];
    }
  | {
      readonly method: "authenticateWithMagicAuth";
      readonly options: Parameters<UserManagement["authenticateWithMagicAuth"]>[0];
    }
  | {
      readonly method: "authenticateWithRefreshToken";
      readonly options: Parameters<UserManagement["authenticateWithRefreshToken"]>[0];
    }
  | {
      readonly method: "challengeFactor";
      readonly options: Parameters<MultiFactorAuth["challengeFactor"]>[0];
    }
  | {
      readonly method: "verifyChallenge";
      readonly options: Parameters<MultiFactorAuth["verifyChallenge"]>[0];
    }
  | {
      readonly method: "createOrganization";
      readonly options: Parameters<Organizations["createOrganization"]>[0];
      readonly requestOptions: Parameters<Organizations["createOrganization"]>[1];
    }
  | {
      readonly method: "createOrganizationMembership";
      readonly options: Parameters<UserManagement["createOrganizationMembership"]>[0];
    };

const authentication = {
  user: {
    id: "user_01HBEQ",
    email: "owner@example.com",
    emailVerified: true,
    profilePictureUrl: "https://images.example/avatar.png",
    name: "Owner Example",
    firstName: "Owner",
    lastName: "Example",
  },
  organizationId: "org_01M0",
  accessToken: "access-token",
  refreshToken: "refresh-token",
} satisfies Awaited<ReturnType<UserManagement["authenticateWithPassword"]>>;

function recorder(passwordFailure?: unknown): { client: WorkOSClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      userManagement: {
        authenticateWithPassword(options) {
          calls.push({ method: "authenticateWithPassword", options });
          if (passwordFailure !== undefined) return Promise.reject(passwordFailure);
          return Promise.resolve(authentication);
        },
        createMagicAuth(options) {
          calls.push({ method: "createMagicAuth", options });
          return Promise.resolve({
            id: "magic_01",
            userId: "user_01HBEQ",
            email: options.email,
            expiresAt: "2026-08-23T02:00:00.000Z",
            code: "123456",
          });
        },
        authenticateWithMagicAuth(options) {
          calls.push({ method: "authenticateWithMagicAuth", options });
          const { organizationId: _organizationId, ...withoutOrganization } = authentication;
          return Promise.resolve(withoutOrganization);
        },
        authenticateWithRefreshToken(options) {
          calls.push({ method: "authenticateWithRefreshToken", options });
          return Promise.resolve(authentication);
        },
        createOrganizationMembership(options) {
          calls.push({ method: "createOrganizationMembership", options });
          return Promise.resolve({ id: "om_01" });
        },
      },
      multiFactorAuth: {
        challengeFactor(options) {
          calls.push({ method: "challengeFactor", options });
          return Promise.resolve({
            id: "challenge_01",
            authenticationFactorId: options.authenticationFactorId,
            expiresAt: "2026-08-23T02:00:00.000Z",
          });
        },
        verifyChallenge(options) {
          calls.push({ method: "verifyChallenge", options });
          return Promise.resolve({
            challenge: {
              id: options.authenticationChallengeId,
              authenticationFactorId: "factor_01",
            },
            valid: true,
          });
        },
      },
      organizations: {
        createOrganization(options, requestOptions) {
          calls.push({ method: "createOrganization", options, requestOptions });
          return Promise.resolve({ id: "org_01M0" });
        },
      },
    },
  };
}

const provider = (client: WorkOSClient) => createWorkOSAuth({ clientId: "client_01", client });

describe("createWorkOSAuth", () => {
  it("constructs the SDK from passed configuration without reading the environment", () => {
    const auth = createWorkOSAuth({ apiKey: "sk_test_01", clientId: "client_01" });
    expect(auth).toHaveProperty("signInWithPassword");
  });

  it("signs in with a password and maps the provider session", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).signInWithPassword({
      email: "owner@example.com",
      password: "correct horse battery staple",
      ipAddress: "203.0.113.10",
      userAgent: "test-agent",
    });

    expect(calls).toStrictEqual([
      {
        method: "authenticateWithPassword",
        options: {
          clientId: "client_01",
          email: "owner@example.com",
          password: "correct horse battery staple",
          ipAddress: "203.0.113.10",
          userAgent: "test-agent",
        },
      },
    ]);
    expect(result).toStrictEqual({
      user: authentication.user,
      organizationId: "org_01M0",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("sends a magic auth code without exposing the returned code", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).sendMagicAuthCode({ email: "owner@example.com" });

    expect(calls).toStrictEqual([
      { method: "createMagicAuth", options: { email: "owner@example.com" } },
    ]);
    expect(result).toStrictEqual({
      id: "magic_01",
      userId: "user_01HBEQ",
      email: "owner@example.com",
      expiresAt: "2026-08-23T02:00:00.000Z",
    });
    expect(result).not.toHaveProperty("code");
  });

  it("verifies a magic auth code and preserves a missing organization as null", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).verifyMagicAuthCode({
      email: "owner@example.com",
      code: "123456",
      ipAddress: "203.0.113.10",
    });

    expect(calls).toStrictEqual([
      {
        method: "authenticateWithMagicAuth",
        options: {
          clientId: "client_01",
          email: "owner@example.com",
          code: "123456",
          ipAddress: "203.0.113.10",
        },
      },
    ]);
    expect(result.organizationId).toBeNull();
  });

  it("creates an MFA challenge for the named factor", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).challengeMfa({ authenticationFactorId: "factor_01" });

    expect(calls).toStrictEqual([
      { method: "challengeFactor", options: { authenticationFactorId: "factor_01" } },
    ]);
    expect(result).toStrictEqual({
      id: "challenge_01",
      authenticationFactorId: "factor_01",
      expiresAt: "2026-08-23T02:00:00.000Z",
    });
  });

  it("verifies one MFA challenge and reports the provider verdict", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).verifyMfa({
      authenticationChallengeId: "challenge_01",
      code: "654321",
    });

    expect(calls).toStrictEqual([
      {
        method: "verifyChallenge",
        options: { authenticationChallengeId: "challenge_01", code: "654321" },
      },
    ]);
    expect(result).toStrictEqual({
      challenge: {
        id: "challenge_01",
        authenticationFactorId: "factor_01",
        expiresAt: null,
      },
      valid: true,
    });
  });

  it("refreshes tokens for a selected organization", async () => {
    const { client, calls } = recorder();
    await provider(client).refreshTokens({
      refreshToken: "old-refresh-token",
      organizationId: "org_01M0",
      userAgent: "test-agent",
    });

    expect(calls).toStrictEqual([
      {
        method: "authenticateWithRefreshToken",
        options: {
          clientId: "client_01",
          refreshToken: "old-refresh-token",
          organizationId: "org_01M0",
          userAgent: "test-agent",
        },
      },
    ]);
  });

  it("refreshes tokens without forcing an organization", async () => {
    const { client, calls } = recorder();
    await provider(client).refreshTokens({ refreshToken: "old-refresh-token" });

    expect(calls).toStrictEqual([
      {
        method: "authenticateWithRefreshToken",
        options: { clientId: "client_01", refreshToken: "old-refresh-token" },
      },
    ]);
  });

  it("creates the organization and membership as one deletable signup operation", async () => {
    const { client, calls } = recorder();
    const result = await provider(client).provisionOrganization({
      name: "Owner Example",
      userId: "user_01HBEQ",
      idempotencyKey: "signup:user_01HBEQ",
      externalId: "account_01",
      metadata: { source: "signup" },
      roleSlugs: ["owner"],
    });

    expect(calls).toStrictEqual([
      {
        method: "createOrganization",
        options: {
          name: "Owner Example",
          externalId: "account_01",
          metadata: { source: "signup" },
        },
        requestOptions: { idempotencyKey: "signup:user_01HBEQ" },
      },
      {
        method: "createOrganizationMembership",
        options: {
          organizationId: "org_01M0",
          userId: "user_01HBEQ",
          roleSlugs: ["owner"],
        },
      },
    ]);
    expect(result).toStrictEqual({ organizationId: "org_01M0", membershipId: "om_01" });
  });

  it("provisions an organization without inventing optional provider data", async () => {
    const { client, calls } = recorder();
    await provider(client).provisionOrganization({
      name: "Owner Example",
      userId: "user_01HBEQ",
      idempotencyKey: "signup:user_01HBEQ",
    });

    expect(calls).toStrictEqual([
      {
        method: "createOrganization",
        options: { name: "Owner Example" },
        requestOptions: { idempotencyKey: "signup:user_01HBEQ" },
      },
      {
        method: "createOrganizationMembership",
        options: { organizationId: "org_01M0", userId: "user_01HBEQ" },
      },
    ]);
  });

  it("translates SDK failures before they leave the package", async () => {
    const { client } = recorder(new UnauthorizedException("request_01"));
    await expect(
      provider(client).signInWithPassword({ email: "owner@example.com", password: "wrong" }),
    ).rejects.toMatchObject({
      name: "WorkOSAuthError",
      reason: "unauthorized",
      requestId: "request_01",
    } satisfies Partial<WorkOSAuthError>);
  });
});
