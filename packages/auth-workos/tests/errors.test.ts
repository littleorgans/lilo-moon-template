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
import { describe, expect, it } from "vitest";

import { translateWorkOSError } from "../src/errors.js";
import type { WorkOSAuthFailure } from "../src/index.js";

type ContinuationCode = Exclude<AuthenticationErrorCode, "sso_required">;

const continuationCases = [
  ["email_verification_required", "email-verification-required"],
  ["organization_selection_required", "organization-selection-required"],
  ["mfa_enrollment", "mfa-enrollment-required"],
  ["mfa_challenge", "mfa-challenge-required"],
  ["mfa_verification", "mfa-verification-required"],
  ["radar_email_challenge", "radar-challenge-required"],
  ["radar_sms_challenge", "radar-challenge-required"],
] satisfies readonly (readonly [ContinuationCode, WorkOSAuthFailure])[];

describe("translateWorkOSError", () => {
  it.each(continuationCases)("maps %s without losing its continuation token", (code, reason) => {
    const error = new AuthenticationException(
      400,
      {
        code,
        message: "Continue authentication",
        pending_authentication_token: "pending_01",
      },
      "request_01",
    );

    expect(translateWorkOSError(error)).toMatchObject({
      reason,
      pendingAuthenticationToken: "pending_01",
      requestId: "request_01",
      cause: error,
    });
  });

  it("maps an SSO continuation", () => {
    const error = new AuthenticationException(
      400,
      { error: "sso_required", error_description: "Use SSO" },
      "request_02",
    );
    expect(translateWorkOSError(error).reason).toBe("sso-required");
  });

  it.each([
    ["invalid-request", new BadRequestException({ message: "bad", requestID: "request_bad" })],
    [
      "invalid-request",
      new UnprocessableEntityException({ message: "invalid", requestID: "request_invalid" }),
    ],
    ["unauthorized", new UnauthorizedException("request_unauthorized")],
    ["unauthorized", new OauthException(401, "request_oauth", "invalid_grant", "bad", {})],
    [
      "not-found",
      new NotFoundException({ message: "missing", path: "/users/x", requestID: "request_missing" }),
    ],
    ["conflict", new ConflictException({ message: "exists", requestID: "request_conflict" })],
    ["rate-limited", new RateLimitExceededException("slow down", "request_rate", 30)],
    ["configuration", new ApiKeyRequiredException("organizations.createOrganization")],
    ["configuration", new NoApiKeyProvidedException()],
    ["unavailable", new GenericServerException(503, "down", { message: "down" }, "request_down")],
    // The two one-time code rejections the live API was measured to return, plus the family match
    // that covers variants it was not.
    [
      "code-rejected",
      new GenericServerException(400, "bad code", { code: "invalid_one_time_code" }, "request_otc"),
    ],
    [
      "code-rejected",
      new GenericServerException(
        400,
        "used code",
        { code: "one_time_code_previously_used" },
        "request_used",
      ),
    ],
    ["provider", new GenericServerException(418, "teapot", {}, "request_teapot")],
    ["provider", new Error("socket closed")],
    ["provider", "non-error rejection"],
  ] satisfies readonly (readonly [WorkOSAuthFailure, unknown])[])(
    "maps provider failure to %s",
    (reason, error) => {
      expect(translateWorkOSError(error).reason).toBe(reason);
    },
  );
});
