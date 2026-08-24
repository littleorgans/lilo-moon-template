import { describe, expect, it } from "vitest";

import { COLOR_TOKENS, renderThemesCss, themes } from "../src/index.js";
import { canvas } from "../src/themes/canvas.js";
import { editor } from "../src/themes/editor.js";

const css = renderThemesCss(themes, { defaultTheme: "editor" });

describe("renderThemesCss", () => {
  it("paints the default theme at :root and .dark", () => {
    expect(css).toContain(`:root {\n  --background: ${editor.light.background};`);
    expect(css).toContain(`.dark {\n  --background: ${editor.dark.background};`);
  });

  it("addresses every theme by data-theme, dark on the element or an ancestor", () => {
    expect(css).toContain(`[data-theme="canvas"] {\n  --background: ${canvas.light.background};`);
    expect(css).toContain('.dark[data-theme="canvas"],\n.dark [data-theme="canvas"]');
    expect(css).toContain(`[data-theme="editor"] {`);
  });

  it("exposes every token to Tailwind and derives the radius scale", () => {
    for (const token of COLOR_TOKENS) {
      expect(css).toContain(`--color-${token}: var(--${token});`);
    }
    expect(css).toContain("--radius-sm: calc(var(--radius) - 4px);");
    expect(css).toContain("--radius-lg: var(--radius);");
    expect(css).toContain(`--radius: ${editor.radius};`);
    expect(css).toContain(`--radius: ${canvas.radius};`);
  });

  it("refuses a default theme that is not in the set", () => {
    expect(() => renderThemesCss(themes, { defaultTheme: "missing" })).toThrow("missing");
  });

  it("refuses a value that escapes the color grammar rather than emitting it", () => {
    const hostile = {
      ...editor,
      light: { ...editor.light, background: "red; } body { display: none" },
    };
    expect(() => renderThemesCss({ editor: hostile }, { defaultTheme: "editor" })).toThrow(
      "light.background",
    );
  });

  it("refuses a theme name that cannot become a selector", () => {
    expect(() => renderThemesCss({ editor, 'x"]': canvas }, { defaultTheme: "editor" })).toThrow(
      "data-theme",
    );
  });

  it("refuses an invalid radius", () => {
    const broken = { ...editor, radius: "6vh" };
    expect(() => renderThemesCss({ editor: broken }, { defaultTheme: "editor" })).toThrow("radius");
  });
});
