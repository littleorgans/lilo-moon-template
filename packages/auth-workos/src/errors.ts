import {
  ApiKeyRequiredException,
  AuthenticationException,
  BadRequestException,
  ConflictException,
  GenericServerException,
  NoApiKeyProvidedException,
  NotFoundException,
  OauthException,
  RateLimitExceededException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@workos-inc/node";
import type { AuthenticationErrorCode } from "@workos-inc/node";

import type { WorkOSAuthFailure } from "./types.js";

export interface WorkOSAuthErrorOptions {
  readonly reason: WorkOSAuthFailure;
  readonly message: string;
  readonly cause: unknown;
  readonly pendingAuthenticationToken?: string;
  readonly requestId?: string;
}

/** An SDK failure translated into a reason callers can handle without reading message text. */
export class WorkOSAuthError extends Error {
  readonly reason: WorkOSAuthFailure;
  readonly pendingAuthenticationToken: string | null;
  readonly requestId: string | null;

  constructor(options: WorkOSAuthErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "WorkOSAuthError";
    this.reason = options.reason;
    this.pendingAuthenticationToken = options.pendingAuthenticationToken ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function authenticationReason(code: AuthenticationErrorCode): WorkOSAuthFailure {
  switch (code) {
    case "email_verification_required":
      return "email-verification-required";
    case "organization_selection_required":
      return "organization-selection-required";
    case "mfa_enrollment":
      return "mfa-enrollment-required";
    case "mfa_challenge":
      return "mfa-challenge-required";
    case "mfa_verification":
      return "mfa-verification-required";
    case "radar_email_challenge":
    case "radar_sms_challenge":
      return "radar-challenge-required";
    case "sso_required":
      return "sso-required";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

function mapped(
  error: Error,
  reason: WorkOSAuthFailure,
  requestId?: string,
  pendingAuthenticationToken?: string,
): WorkOSAuthError {
  return new WorkOSAuthError({
    reason,
    message: error.message,
    cause: error,
    ...(requestId === undefined ? {} : { requestId }),
    ...(pendingAuthenticationToken === undefined ? {} : { pendingAuthenticationToken }),
  });
}

export function translateWorkOSError(error: unknown): WorkOSAuthError {
  if (error instanceof AuthenticationException) {
    return mapped(
      error,
      authenticationReason(error.code),
      error.requestID,
      error.pendingAuthenticationToken,
    );
  }
  if (error instanceof RateLimitExceededException) {
    return mapped(error, "rate-limited", error.requestID);
  }
  if (error instanceof BadRequestException || error instanceof UnprocessableEntityException) {
    return mapped(error, "invalid-request", error.requestID);
  }
  if (error instanceof UnauthorizedException || error instanceof OauthException) {
    return mapped(error, "unauthorized", error.requestID);
  }
  if (error instanceof NotFoundException) {
    return mapped(error, "not-found", error.requestID);
  }
  if (error instanceof ConflictException) {
    return mapped(error, "conflict", error.requestID);
  }
  if (error instanceof ApiKeyRequiredException || error instanceof NoApiKeyProvidedException) {
    return mapped(error, "configuration");
  }
  if (error instanceof GenericServerException && error.status >= 500) {
    return mapped(error, "unavailable", error.requestID);
  }
  const providerError = error instanceof Error ? error : new Error(String(error));
  return mapped(providerError, "provider");
}
