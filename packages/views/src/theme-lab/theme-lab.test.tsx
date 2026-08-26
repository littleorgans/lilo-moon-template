import { COLOR_TOKENS } from "@lilo-moon/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeLab } from "./theme-lab.js";

const html = renderToStaticMarkup(
  <ThemeLab preference={{ mode: "light", theme: "editor" }} setPath="/api/theme" />,
);

describe("ThemeLab", () => {
  it("embeds the switcher wired to the given path", () => {
    expect(html).toContain('data-slot="theme-switcher"');
    expect(html).toContain('action="/api/theme"');
  });

  it("renders every button and badge variant by name", () => {
    for (const variant of ["default", "secondary", "outline", "ghost", "destructive", "link"]) {
      expect(html).toContain(`data-variant="${variant}"`);
    }
  });

  // The swatches are the point of the page: one per token, reading the variable live.
  it("renders one swatch per color token, reading its CSS variable", () => {
    for (const token of COLOR_TOKENS) {
      expect(html).toContain(`data-token="${token}"`);
      expect(html).toContain(`var(--${token})`);
    }
  });

  it("shows the labelled field and the text tones", () => {
    expect(html).toContain('for="theme-lab-input"');
    expect(html).toContain("Muted text");
    expect(html).toContain("Destructive text");
  });
});
