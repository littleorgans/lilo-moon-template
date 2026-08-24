export type { WorkOSClient } from "./client.js";
export { WorkOSAuthError } from "./errors.js";
export type { WorkOSAuthErrorOptions } from "./errors.js";
export { createWorkOSAuth } from "./provider.js";
export type {
  AuthenticateWithCodeOptions,
  AuthenticatedUser,
  Authentication,
  AuthorizationProvider,
  AuthorizationUrlOptions,
  MagicAuthCode,
  MfaChallenge,
  MfaChallengeOptions,
  MfaVerification,
  PasswordSignInOptions,
  ProvisionedOrganization,
  ProvisionOrganizationOptions,
  RefreshTokensOptions,
  RequestContext,
  SendMagicAuthCodeOptions,
  VerifyMagicAuthCodeOptions,
  VerifyMfaOptions,
  WorkOSAuth,
  WorkOSAuthFailure,
  WorkOSAuthOptions,
} from "./types.js";
