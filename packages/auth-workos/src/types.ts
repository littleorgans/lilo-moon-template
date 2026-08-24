import type { WorkOSClient } from "./client.js";

export type WorkOSAuthFailure =
  | "email-verification-required"
  | "organization-selection-required"
  | "mfa-enrollment-required"
  | "mfa-challenge-required"
  | "mfa-verification-required"
  | "radar-challenge-required"
  | "sso-required"
  | "code-rejected"
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

/**
 * Where the browser is sent to prove who it is.
 *
 * `authkit` is the provider's own hosted sign-in page. The rest jump straight to one social
 * provider and skip that page. Enterprise SSO is selected by `connectionId` or `organizationId`
 * instead, so it is not a member of this union.
 *
 * The social credentials are configured per environment rather than per application, so every
 * application in one environment shares them. Enabling a custom AuthKit domain regenerates each
 * provider's redirect URI and forces re-registration with that provider, which is the reason to
 * add providers deliberately rather than because the union permits them.
 */
export type AuthorizationProvider =
  | "authkit"
  | "AppleOAuth"
  | "GitHubOAuth"
  | "GoogleOAuth"
  | "MicrosoftOAuth";

export interface AuthorizationUrlOptions {
  /** Must already be registered with the provider. An unregistered value fails at the provider. */
  readonly redirectUri: string;
  /**
   * Round-tripped to the callback, and the only defence against a forged authorization response.
   *
   * Required rather than optional because an omitted state is a silent vulnerability: the flow
   * still completes, and the callback can no longer tell its own redirect from an attacker's.
   * Generate an unguessable value, store it where the callback can read it, and compare.
   *
   * Verified 2026-08-24: the provider wraps this value in its own signed envelope and returns it
   * unchanged, so it is genuinely ours to use.
   */
  readonly state: string;
  readonly provider?: AuthorizationProvider;
  readonly connectionId?: string;
  readonly organizationId?: string;
  readonly loginHint?: string;
  readonly screenHint?: "sign-in" | "sign-up";
}

export interface AuthenticateWithCodeOptions extends RequestContext {
  readonly code: string;
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
  /** Builds the URL that starts a redirect sign-in. Local, so it cannot fail over the network. */
  getAuthorizationUrl(options: AuthorizationUrlOptions): string;
  /** Exchanges the code the callback received. Verify `state` before calling this. */
  authenticateWithCode(options: AuthenticateWithCodeOptions): Promise<Authentication>;
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
