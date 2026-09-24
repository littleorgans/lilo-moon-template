import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CLOCK_TOLERANCE_SECONDS,
  CODE_LIFETIME_SECONDS,
  REFRESH_MARGIN_SECONDS,
  REUSE_NEEDED_SECONDS,
} from "../src/assumptions.js";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// The contract suite measures the provider against these numbers, so a package that changes one
// must change the contract with it. This runs in `moon ci`; the contract suite does not.
describe("the contract's copies of the packages' constants", () => {
  it("match the early-refresh margin in auth-session", () => {
    expect(source("auth-session/src/access.ts")).toMatch(
      new RegExp(`^export const REFRESH_MARGIN_SECONDS = ${REFRESH_MARGIN_SECONDS};$`, "m"),
    );
  });

  it("match the verifier's default clock tolerance in auth", () => {
    expect(source("auth/src/verify.ts")).toContain(
      `clockTolerance: options.clockToleranceSeconds ?? ${CLOCK_TOLERANCE_SECONDS},`,
    );
  });

  it("match the email cookie's lifetime in auth-session", () => {
    expect(source("auth-session/src/email.ts")).toMatch(
      new RegExp(`^const EMAIL_MAX_AGE_SECONDS = ${CODE_LIFETIME_SECONDS};$`, "m"),
    );
  });

  it("need less reuse than the 30 seconds WorkOS documents", () => {
    expect(REUSE_NEEDED_SECONDS).toBeLessThan(30);
  });
});
