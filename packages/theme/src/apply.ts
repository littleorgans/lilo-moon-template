import { COLOR_TOKENS } from "./contract.js";
import type { ProductTheme } from "./contract.js";

/**
 * The two methods of `CSSStyleDeclaration` this package needs, described structurally so the
 * package never depends on DOM types and a test never needs a browser. `element.style` satisfies
 * it as-is. The same seam shape as `CookieJar` in `packages/auth-session`, for the same reason:
 * the coverage gate refuses code that can only run inside an environment tests do not have.
 */
export interface ThemeTarget {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

export type ThemeMode = "light" | "dark";

/**
 * Writes a theme's variables onto one element, for themes that are data rather than CSS: a
 * user-edited theme from the database. Built-in themes never need this, their CSS is generated;
 * pass user input through `validateTheme` first, because a property value is still text that
 * reaches the style engine.
 */
export function applyTheme(target: ThemeTarget, theme: ProductTheme, mode: ThemeMode): void {
  const palette = mode === "dark" ? theme.dark : theme.light;
  for (const token of COLOR_TOKENS) {
    target.setProperty(`--${token}`, palette[token]);
  }
  target.setProperty("--radius", theme.radius);
}

/** Removes everything `applyTheme` set, returning the element to the generated CSS. */
export function clearTheme(target: ThemeTarget): void {
  for (const token of COLOR_TOKENS) {
    target.removeProperty(`--${token}`);
  }
  target.removeProperty("--radius");
}
