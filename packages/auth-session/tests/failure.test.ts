import { WorkOSAuthError } from "@lilo-moon/auth-workos";
import type { WorkOSAuthFailure } from "@lilo-moon/auth-workos";
import { describe, expect, it } from "vitest";

import { dispositionFor, failurePage, messageFor, reasonFor } from "../src/failure.js";
import type { CallbackDisposition } from "../src/failure.js";

/**
 * Every member of the union, written out.
 *
 * Listing them by hand is the point. A value added to `WorkOSAuthFailure` without a decision about
 * what the person sees fails this file, which is the only thing standing between a new provider
 * error and a blank page.
 */
const EVERY_REASON: readonly WorkOSAuthFailure[] = [
  "email-verification-required",
  "organization-selection-required",
  "mfa-enrollment-required",
  "mfa-challenge-required",
  "mfa-verification-required",
  "radar-challenge-required",
  "sso-required",
  "invalid-request",
  "unauthorized",
  "not-found",
  "conflict",
  "rate-limited",
  "configuration",
  "unavailable",
  "provider",
];

describe("dispositionFor", () => {
  it.each(EVERY_REASON)("gives %s a disposition", (reason) => {
    expect(["retry", "unsupported", "misconfigured"]).toContain(dispositionFor(reason));
  });

  // Waiting is the entire remedy for these two, so telling someone to try again is true advice
  // rather than the thing you say when you have nothing.
  it("tells the person to wait only when waiting would help", () => {
    const retryable = EVERY_REASON.filter((reason) => dispositionFor(reason) === "retry");
    expect(retryable).toStrictEqual(["rate-limited", "unavailable"]);
  });

  // The case that produced this module: a wrong API key arrives as `unauthorized`.
  it("treats a rejected credential as our misconfiguration, not the person's problem", () => {
    expect(dispositionFor("unauthorized")).toBe("misconfigured");
  });

  it("treats an unrecognised provider failure as misconfiguration", () => {
    expect(dispositionFor("provider")).toBe("misconfigured");
  });

  it("calls the AuthKit steps this application has not built unsupported", () => {
    expect(dispositionFor("mfa-enrollment-required")).toBe("unsupported");
    expect(dispositionFor("organization-selection-required")).toBe("unsupported");
    expect(dispositionFor("sso-required")).toBe("unsupported");
  });
});

describe("messageFor", () => {
  const dispositions: readonly CallbackDisposition[] = ["retry", "unsupported", "misconfigured"];

  it("gives each disposition its own wording", () => {
    const messages = dispositions.map(messageFor);
    expect(new Set(messages).size).toBe(dispositions.length);
  });

  // A message naming the failed check tells someone probing the callback which one to change, and
  // several of these failures are indistinguishable from exactly that.
  //
  // Only the hyphenated reasons are asserted on. Those are the ones that could have arrived only
  // from the machine, so finding one in a sentence means a reason leaked. The single-word reasons
  // are ordinary English and cannot be told apart from copy: `unavailable` is a leak in one
  // sentence and the correct word in another, and a test cannot see the difference. What stops
  // those leaking is the rendered-page assertion in callback.test.ts.
  const machineOnly = EVERY_REASON.filter((reason) => reason.includes("-"));

  it.each(dispositions)("keeps machine reasons out of the %s message", (disposition) => {
    for (const reason of machineOnly) {
      expect(messageFor(disposition)).not.toContain(reason);
    }
  });
});

describe("reasonFor", () => {
  it("reads the reason off a translated provider error", () => {
    const error = new WorkOSAuthError({
      reason: "rate-limited",
      message: "slow down",
      cause: new Error("429"),
    });
    expect(reasonFor(error)).toBe("rate-limited");
  });

  // A callback has to render something for every throw, including the ones that never reached the
  // vendor.
  it("calls anything else a provider failure", () => {
    expect(reasonFor(new Error("socket hang up"))).toBe("provider");
    expect(reasonFor("a string nobody expected")).toBe("provider");
    expect(reasonFor(undefined)).toBe("provider");
  });
});

describe("failurePage", () => {
  it("renders the message with a way back", async () => {
    const response = failurePage("Something went wrong.");
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Something went wrong.");
    expect(body).toContain('href="/"');
  });

  // This page has to render when the rest of the request is broken, so it may not depend on a
  // stylesheet, a bundle, or anything else that has to load first.
  it("depends on nothing that has to load", async () => {
    const body = await failurePage("Something went wrong.").text();
    expect(body).not.toContain("<script");
    expect(body).not.toContain("stylesheet");
  });
});
