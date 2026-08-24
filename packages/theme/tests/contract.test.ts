import { describe, expect, it } from "vitest";

import { COLOR_TOKENS, themes, validateTheme } from "../src/index.js";

describe("the token contract", () => {
  it("has no duplicate tokens", () => {
    expect(new Set(COLOR_TOKENS).size).toBe(COLOR_TOKENS.length);
  });

  // The built-in themes must pass the same boundary a user theme does. A theme that typechecks
  // but fails the value grammar would otherwise only surface when the generator refuses it.
  it("every built-in theme satisfies the runtime validator", () => {
    for (const [name, theme] of Object.entries(themes)) {
      const result = validateTheme(theme);
      expect(result.ok, `theme ${name}`).toBe(true);
    }
  });
});
