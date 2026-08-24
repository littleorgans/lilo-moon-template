import { describe, expect, it } from "vitest";

import { COLOR_TOKENS, applyTheme, clearTheme, editor } from "../src/index.js";
import type { ThemeTarget } from "../src/index.js";

function recordingTarget(): ThemeTarget & { readonly set: Map<string, string> } {
  const set = new Map<string, string>();
  return {
    set,
    setProperty: (name, value) => set.set(name, value),
    removeProperty: (name) => set.delete(name),
  };
}

describe("applyTheme", () => {
  it("writes every token plus the radius, from the requested mode", () => {
    const target = recordingTarget();
    applyTheme(target, editor, "dark");

    expect(target.set.size).toBe(COLOR_TOKENS.length + 1);
    expect(target.set.get("--background")).toBe(editor.dark.background);
    expect(target.set.get("--radius")).toBe(editor.radius);
  });

  it("light mode writes the light palette", () => {
    const target = recordingTarget();
    applyTheme(target, editor, "light");
    expect(target.set.get("--background")).toBe(editor.light.background);
  });
});

describe("clearTheme", () => {
  it("removes exactly what applyTheme set", () => {
    const target = recordingTarget();
    applyTheme(target, editor, "light");
    clearTheme(target);
    expect(target.set.size).toBe(0);
  });
});
