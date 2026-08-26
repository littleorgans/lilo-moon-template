import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeSwitcher } from "./theme-switcher.js";

const html = renderToStaticMarkup(
  <ThemeSwitcher preference={{ mode: "dark", theme: "canvas" }} setPath="/api/theme" />,
);

describe("ThemeSwitcher", () => {
  // A round-trip, not a fetch: the server sets the cookie and the redirect repaints the page.
  it("is one form posting to the theme route", () => {
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/theme"');
  });

  it("submits each choice as its own named button", () => {
    for (const [name, value] of [
      ["mode", "light"],
      ["mode", "dark"],
      ["theme", "editor"],
      ["theme", "canvas"],
    ]) {
      // Lookaheads, because React orders a button's name and value attributes as it pleases.
      expect(html).toMatch(
        new RegExp(`<button(?=[^>]*name="${name}")(?=[^>]*value="${value}")[^>]*>`),
      );
    }
  });

  it("marks exactly the current mode and theme pressed", () => {
    const pressed = html.match(/aria-pressed="true"/g) ?? [];
    expect(pressed).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*>dark/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>canvas/);
  });
});
