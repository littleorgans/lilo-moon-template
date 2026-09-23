import { findPackageJSON } from "node:module";

import { describe, expect, it, vi } from "vitest";

import { drizzleKitBin } from "../src/drizzle.js";

vi.mock("node:module", () => ({ findPackageJSON: vi.fn() }));

describe("the optional drizzle-kit peer", () => {
  it("names the install command when Node throws for an absent peer", () => {
    vi.mocked(findPackageJSON).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" });
    });
    expect(drizzleKitBin).toThrow("pnpm add -D drizzle-kit");
  });

  it("names the install command when resolution has no manifest", () => {
    vi.mocked(findPackageJSON).mockReturnValue(undefined);
    expect(drizzleKitBin).toThrow("pnpm add -D drizzle-kit");
  });

  it("preserves errors other than an absent package", () => {
    vi.mocked(findPackageJSON).mockImplementation(() => {
      throw new Error("broken manifest");
    });
    expect(drizzleKitBin).toThrow("broken manifest");
  });
});
