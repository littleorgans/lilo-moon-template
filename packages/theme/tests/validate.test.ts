import { describe, expect, it } from "vitest";

import { editor, validateTheme } from "../src/index.js";

function issuesOf(value: unknown): readonly { path: string; reason: string }[] {
  const result = validateTheme(value);
  return result.ok ? [] : result.issues;
}

describe("validateTheme", () => {
  it("round-trips a complete theme", () => {
    const result = validateTheme(JSON.parse(JSON.stringify(editor)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.radius).toBe(editor.radius);
  });

  it("rejects a non-object outright", () => {
    expect(issuesOf("nope")).toEqual([{ path: "", reason: "not-an-object" }]);
    expect(issuesOf(null)).toEqual([{ path: "", reason: "not-an-object" }]);
    expect(issuesOf([])).toEqual([{ path: "", reason: "not-an-object" }]);
  });

  it("collects every issue rather than stopping at the first", () => {
    const broken = {
      light: { ...editor.light, background: "url(javascript:alert(1))", extra: "#fff" },
      radius: "6vh",
      surprise: true,
    };
    const issues = issuesOf(broken);
    expect(issues).toContainEqual({ path: "light.background", reason: "not-a-color" });
    expect(issues).toContainEqual({ path: "light.extra", reason: "unknown-key" });
    expect(issues).toContainEqual({ path: "dark", reason: "not-an-object" });
    expect(issues).toContainEqual({ path: "radius", reason: "not-a-radius" });
    expect(issues).toContainEqual({ path: "surprise", reason: "unknown-key" });
  });

  it("a broken palette reports only its own issues", () => {
    const broken = { light: { ...editor.light, background: 7 }, dark: editor.dark, radius: "1rem" };
    const issues = issuesOf(broken);
    expect(issues).toEqual([{ path: "light.background", reason: "not-a-string" }]);
  });

  it("names each missing token", () => {
    const { background: _dropped, ...partial } = editor.light;
    const issues = issuesOf({ light: partial, dark: editor.dark, radius: "1rem" });
    expect(issues).toEqual([{ path: "light.background", reason: "missing" }]);
  });

  it("missing radius is reported as missing", () => {
    const issues = issuesOf({ light: editor.light, dark: editor.dark });
    expect(issues).toEqual([{ path: "radius", reason: "missing" }]);
  });
});
