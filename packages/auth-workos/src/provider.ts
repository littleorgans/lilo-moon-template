import { WorkOS } from "@workos-inc/node";

import type { WorkOSClient } from "./client.js";
import { translateWorkOSError } from "./errors.js";
import type {
  Authentication,
  MagicAuthCode,
  MfaChallenge,
  MfaVerification,
  ProvisionedOrganization,
  RequestContext,
  WorkOSAuth,
  WorkOSAuthOptions,
} from "./types.js";

function requestContext(options: RequestContext): {
  readonly ipAddress?: string;
  readonly userAgent?: string;
} {
  return {
    ...(options.ipAddress === undefined ? {} : { ipAddress: options.ipAddress }),
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  };
}

function authenticationFrom(
  response: Awaited<ReturnType<WorkOSClient["userManagement"]["authenticateWithPassword"]>>,
): Authentication {
  return {
    user: {
      id: response.user.id,
      email: response.user.email,
      emailVerified: response.user.emailVerified,
      profilePictureUrl: response.user.profilePictureUrl,
      name: response.user.name,
      firstName: response.user.firstName,
      lastName: response.user.lastName,
    },
    organizationId: response.organizationId ?? null,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
  };
}

function magicAuthCodeFrom(
  response: Awaited<ReturnType<WorkOSClient["userManagement"]["createMagicAuth"]>>,
): MagicAuthCode {
  return {
    id: response.id,
    userId: response.userId,
    email: response.email,
    expiresAt: response.expiresAt,
  };
}

function mfaChallengeFrom(
  response: Awaited<ReturnType<WorkOSClient["multiFactorAuth"]["challengeFactor"]>>,
): MfaChallenge {
  return {
    id: response.id,
    authenticationFactorId: response.authenticationFactorId,
    expiresAt: response.expiresAt ?? null,
  };
}

async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw translateWorkOSError(error);
  }
}

function clientFrom(options: WorkOSAuthOptions): WorkOSClient {
  if ("client" in options) return options.client;
  return new WorkOS({ apiKey: options.apiKey, clientId: options.clientId });
}

export function createWorkOSAuth(options: WorkOSAuthOptions): WorkOSAuth {
  const client = clientFrom(options);
  const { clientId } = options;

  return {
    async signInWithPassword(input) {
      const response = await providerCall(
        async () =>
          await client.userManagement.authenticateWithPassword({
            clientId,
            email: input.email,
            password: input.password,
            ...requestContext(input),
          }),
      );
      return authenticationFrom(response);
    },

    async sendMagicAuthCode(input) {
      const response = await providerCall(
        async () =>
          await client.userManagement.createMagicAuth({
            email: input.email,
            ...requestContext(input),
          }),
      );
      return magicAuthCodeFrom(response);
    },

    async verifyMagicAuthCode(input) {
      const response = await providerCall(
        async () =>
          await client.userManagement.authenticateWithMagicAuth({
            clientId,
            email: input.email,
            code: input.code,
            ...requestContext(input),
          }),
      );
      return authenticationFrom(response);
    },

    async challengeMfa(input) {
      const response = await providerCall(
        async () =>
          await client.multiFactorAuth.challengeFactor({
            authenticationFactorId: input.authenticationFactorId,
          }),
      );
      return mfaChallengeFrom(response);
    },

    async verifyMfa(input): Promise<MfaVerification> {
      const response = await providerCall(
        async () =>
          await client.multiFactorAuth.verifyChallenge({
            authenticationChallengeId: input.authenticationChallengeId,
            code: input.code,
          }),
      );
      return {
        challenge: mfaChallengeFrom(response.challenge),
        valid: response.valid,
      };
    },

    async refreshTokens(input) {
      const response = await providerCall(
        async () =>
          await client.userManagement.authenticateWithRefreshToken({
            clientId,
            refreshToken: input.refreshToken,
            ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
            ...requestContext(input),
          }),
      );
      return authenticationFrom(response);
    },

    async provisionOrganization(input): Promise<ProvisionedOrganization> {
      const organization = await providerCall(
        async () =>
          await client.organizations.createOrganization(
            {
              name: input.name,
              ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
              ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
            },
            { idempotencyKey: input.idempotencyKey },
          ),
      );
      const membership = await providerCall(
        async () =>
          await client.userManagement.createOrganizationMembership({
            organizationId: organization.id,
            userId: input.userId,
            ...(input.roleSlugs === undefined ? {} : { roleSlugs: [...input.roleSlugs] }),
          }),
      );
      return { organizationId: organization.id, membershipId: membership.id };
    },
  };
}
