import type { WorkOSClient } from "./client.js";

export type WorkOSAuthFailure =
  | "email-verification-required"
  | "organization-selection-required"
  | "mfa-enrollment-required"
  | "mfa-challenge-required"
  | "mfa-verification-required"
  | "radar-challenge-required"
  | "sso-required"
  | "invalid-request"
  | "unauthorized"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "configuration"
  | "unavailable"
  | "provider";

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly profilePictureUrl: string | null;
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface Authentication {
  readonly user: AuthenticatedUser;
  readonly organizationId: string | null;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface RequestContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface PasswordSignInOptions extends RequestContext {
  readonly email: string;
  readonly password: string;
}

export interface SendMagicAuthCodeOptions extends RequestContext {
  readonly email: string;
}

export interface MagicAuthCode {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: string;
}

export interface VerifyMagicAuthCodeOptions extends RequestContext {
  readonly email: string;
  readonly code: string;
}

export interface MfaChallengeOptions {
  readonly authenticationFactorId: string;
}

export interface MfaChallenge {
  readonly id: string;
  readonly authenticationFactorId: string;
  readonly expiresAt: string | null;
}

export interface VerifyMfaOptions {
  readonly authenticationChallengeId: string;
  readonly code: string;
}

export interface MfaVerification {
  readonly challenge: MfaChallenge;
  readonly valid: boolean;
}

export interface RefreshTokensOptions extends RequestContext {
  readonly refreshToken: string;
  readonly organizationId?: string;
}

export interface ProvisionOrganizationOptions {
  readonly name: string;
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly externalId?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly roleSlugs?: readonly string[];
}

export interface ProvisionedOrganization {
  readonly organizationId: string;
  readonly membershipId: string;
}

export interface WorkOSAuth {
  signInWithPassword(options: PasswordSignInOptions): Promise<Authentication>;
  sendMagicAuthCode(options: SendMagicAuthCodeOptions): Promise<MagicAuthCode>;
  verifyMagicAuthCode(options: VerifyMagicAuthCodeOptions): Promise<Authentication>;
  challengeMfa(options: MfaChallengeOptions): Promise<MfaChallenge>;
  verifyMfa(options: VerifyMfaOptions): Promise<MfaVerification>;
  refreshTokens(options: RefreshTokensOptions): Promise<Authentication>;
  provisionOrganization(options: ProvisionOrganizationOptions): Promise<ProvisionedOrganization>;
}

/** Production constructs the SDK from configuration. Tests inject the narrow client instead. */
export type WorkOSAuthOptions =
  | {
      readonly apiKey: string;
      readonly clientId: string;
      readonly client?: never;
    }
  | {
      readonly client: WorkOSClient;
      readonly clientId: string;
      readonly apiKey?: never;
    };
