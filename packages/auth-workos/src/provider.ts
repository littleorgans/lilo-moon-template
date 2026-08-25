import { WorkOS } from "@workos-inc/node";

import type { WorkOSClient } from "./client.js";
import { WorkOSAuthError, translateWorkOSError } from "./errors.js";
import type {
  AuthorizationUrlOptions,
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

// The synchronous twin. `getAuthorizationUrl` builds a string locally, so wrapping it in a promise
// would claim a network failure mode it does not have.
function providerCallSync<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw translateWorkOSError(error);
  }
}

function misconfigured(message: string): WorkOSAuthError {
  return new WorkOSAuthError({ reason: "configuration", message, cause: undefined });
}

/**
 * Refuses two authorization URLs that would look fine and behave badly.
 *
 * An empty `state` type-checks and disables the callback's only defence against a forged
 * authorization response, silently: the flow still completes. Selecting no identity path produces
 * a 400 from the provider, which is a network round trip spent to learn something knowable here.
 */
function assertAuthorizable(options: AuthorizationUrlOptions): void {
  if (options.state.length === 0) {
    throw misconfigured(
      "getAuthorizationUrl requires a non-empty state: it is what proves the callback's response is the one this application asked for.",
    );
  }
  if (
    options.provider === undefined &&
    options.connectionId === undefined &&
    options.organizationId === undefined
  ) {
    throw misconfigured(
      "getAuthorizationUrl requires one of provider, connectionId or organizationId to choose an identity path.",
    );
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
    getAuthorizationUrl(input): string {
      assertAuthorizable(input);
      return providerCallSync(() =>
        client.userManagement.getAuthorizationUrl({
          clientId,
          redirectUri: input.redirectUri,
          state: input.state,
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
          ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
          ...(input.loginHint === undefined ? {} : { loginHint: input.loginHint }),
          ...(input.screenHint === undefined ? {} : { screenHint: input.screenHint }),
        }),
      );
    },

    async authenticateWithCode(input) {
      const response = await providerCall(
        async () =>
          await client.userManagement.authenticateWithCode({
            clientId,
            code: input.code,
            ...requestContext(input),
          }),
      );
      return authenticationFrom(response);
    },

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

    /**
     * Creates the organization and the membership, and is safe to call again after either one.
     *
     * Two calls, so there are two ways to be interrupted, and both were reachable: a crash between
     * them left an organization nobody belonged to, and a callback delivered twice ran the pair
     * twice and gave one person two workspaces. Neither is repaired by retrying a plain create.
     *
     * `externalId` closes both. The API refuses a second organization claiming one, so the retry
     * that would have created a duplicate collides instead, and the collision names the
     * organization to adopt. Membership is then created against whichever organization this call
     * ended up holding, and repeating that is already free: creating a membership that exists
     * returns the existing one rather than a second, measured against the live API.
     *
     * So the interrupted signup finishes on the person's next sign-in rather than leaving them to
     * discover the damage, and it finishes in the organization the first attempt created.
     */
    async provisionOrganization(input): Promise<ProvisionedOrganization> {
      const organization = await providerCall(async () => {
        try {
          return await client.organizations.createOrganization({
            name: input.name,
            externalId: input.externalId,
            ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
          });
        } catch (error) {
          // Translated only to read the reason. The raw error is rethrown so `providerCall` stays
          // the single place that converts one, rather than two paths producing the same type.
          if (translateWorkOSError(error).reason !== "conflict") throw error;
          // The lookup can fail in its own right, and it is left to translate normally: an
          // organization holding this id existed a moment ago, so a failure to read it back is a
          // real failure and not a state to paper over.
          return await client.organizations.getOrganizationByExternalId(input.externalId);
        }
      });
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
