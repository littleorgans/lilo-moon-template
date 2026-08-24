import { WorkOSAuthError } from "@lilo-moon/auth-workos";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportAuthFailure } from "../src/log.js";

function captured(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportAuthFailure", () => {
  it("writes one structured line naming the failure", () => {
    const { lines, restore } = captured();
    reportAuthFailure({
      reason: "unauthorized",
      disposition: "misconfigured",
      error: new Error("Invalid client secret."),
    });
    restore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toStrictEqual({
      event: "auth.callback.failed",
      reason: "unauthorized",
      disposition: "misconfigured",
      error: "Invalid client secret.",
    });
  });

  // A WorkOSAuthError carries a `cause` chain holding the vendor's raw exception. Serialising it
  // whole is how a logger throws inside the failure path it was called about, hiding it.
  it("survives an error carrying a cause chain", () => {
    const { lines, restore } = captured();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    reportAuthFailure({
      reason: "provider",
      disposition: "misconfigured",
      error: new WorkOSAuthError({ reason: "provider", message: "vendor said no", cause: cyclic }),
    });
    restore();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ error: "vendor said no" });
  });

  it("reports something for a throw that was never an Error", () => {
    const { lines, restore } = captured();
    reportAuthFailure({ reason: "provider", disposition: "misconfigured", error: "a bare string" });
    restore();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ error: "a bare string" });
  });
});
