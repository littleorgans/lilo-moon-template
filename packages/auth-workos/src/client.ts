interface ProviderRequestContext {
  readonly clientId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

interface ProviderUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly profilePictureUrl: string | null;
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

interface ProviderAuthentication {
  readonly user: ProviderUser;
  readonly organizationId?: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface ProviderMagicAuthCode {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: string;
  readonly code: string;
}

interface ProviderMfaChallenge {
  readonly id: string;
  readonly authenticationFactorId: string;
  readonly expiresAt?: string;
}

interface ProviderMfaVerification {
  readonly challenge: ProviderMfaChallenge;
  readonly valid: boolean;
}

/**
 * The exact slice of the WorkOS SDK used by this package.
 *
 * Keeping the dependency structural lets tests use a recording client without a network. It also
 * makes an SDK upgrade fail typecheck when one of these provider calls changes.
 */
export interface WorkOSClient {
  readonly userManagement: {
    authenticateWithPassword(
      options: ProviderRequestContext & { readonly email: string; readonly password: string },
    ): Promise<ProviderAuthentication>;
    createMagicAuth(
      options: Omit<ProviderRequestContext, "clientId"> & { readonly email: string },
    ): Promise<ProviderMagicAuthCode>;
    authenticateWithMagicAuth(
      options: ProviderRequestContext & { readonly code: string; readonly email: string },
    ): Promise<ProviderAuthentication>;
    authenticateWithRefreshToken(
      options: ProviderRequestContext & {
        readonly refreshToken: string;
        readonly organizationId?: string;
      },
    ): Promise<ProviderAuthentication>;
    createOrganizationMembership(options: {
      readonly organizationId: string;
      readonly userId: string;
      readonly roleSlugs?: string[];
    }): Promise<{ readonly id: string }>;
  };
  readonly multiFactorAuth: {
    challengeFactor(options: {
      readonly authenticationFactorId: string;
    }): Promise<ProviderMfaChallenge>;
    verifyChallenge(options: {
      readonly authenticationChallengeId: string;
      readonly code: string;
    }): Promise<ProviderMfaVerification>;
  };
  readonly organizations: {
    createOrganization(
      options: {
        readonly name: string;
        readonly externalId?: string | null;
        readonly metadata?: Record<string, string>;
      },
      requestOptions: { readonly idempotencyKey: string },
    ): Promise<{ readonly id: string }>;
  };
}
