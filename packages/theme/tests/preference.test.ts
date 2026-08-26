import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCE,
  cookieValue,
  nextPreference,
  parseThemePreference,
  serializeThemePreference,
} from "../src/preference.js";

describe("parseThemePreference", () => {
  it("round-trips what serializeThemePreference wrote", () => {
    const preference = { mode: "dark", theme: "canvas" } as const;
    expect(parseThemePreference(serializeThemePreference(preference))).toEqual(preference);
  });

  it("defaults a missing cookie", () => {
    expect(parseThemePreference(undefined)).toEqual(DEFAULT_PREFERENCE);
    expect(parseThemePreference(null)).toEqual(DEFAULT_PREFERENCE);
  });

  // A cookie written before a theme was removed keeps its mode; each half falls back alone.
  it("falls back per half, not whole-or-nothing", () => {
    expect(parseThemePreference("dark:retired-theme")).toEqual({ mode: "dark", theme: "editor" });
    expect(parseThemePreference("sepia:canvas")).toEqual({ mode: "light", theme: "canvas" });
    expect(parseThemePreference("garbage")).toEqual(DEFAULT_PREFERENCE);
    expect(parseThemePreference("")).toEqual(DEFAULT_PREFERENCE);
  });
});

describe("nextPreference", () => {
  const current = { mode: "dark", theme: "canvas" } as const;

  it("applies one submitted half and carries the other over", () => {
    expect(nextPreference(current, "light", null)).toEqual({ mode: "light", theme: "canvas" });
    expect(nextPreference(current, null, "editor")).toEqual({ mode: "dark", theme: "editor" });
  });

  // Form fields are attacker-controlled text; nothing invalid may become state.
  it("changes nothing on values that validate against nothing", () => {
    expect(nextPreference(current, "sepia", "not-a-theme")).toEqual(current);
    expect(nextPreference(current, 7, ["editor"])).toEqual(current);
  });
});

describe("cookieValue", () => {
  it("finds the named cookie among others, whitespace tolerated", () => {
    expect(cookieValue("a=1; theme=dark:canvas; b=2", "theme")).toBe("dark:canvas");
    expect(cookieValue("theme=light:editor", "theme")).toBe("light:editor");
  });

  it("returns undefined for an absent header, absent cookie, or malformed pair", () => {
    expect(cookieValue(null, "theme")).toBeUndefined();
    expect(cookieValue("a=1; b=2", "theme")).toBeUndefined();
    expect(cookieValue("nonsense; theme", "theme")).toBeUndefined();
  });

  // "theme" must not match "color-theme"; the name comparison is exact.
  it("matches the whole name only", () => {
    expect(cookieValue("color-theme=x; theme=y", "theme")).toBe("y");
  });
});
