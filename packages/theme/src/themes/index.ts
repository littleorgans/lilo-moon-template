import type { ProductTheme } from "../contract.js";
import { canvas } from "./canvas.js";
import { editor } from "./editor.js";

/**
 * Every built-in product theme, keyed by the name that becomes its `data-theme` value. `satisfies`
 * keeps the keys inferable as literals while still forcing each entry to be a complete theme.
 */
export const themes = { editor, canvas } satisfies Record<string, ProductTheme>;

export type ThemeName = keyof typeof themes;

/**
 * The names as a list, for anything that renders one control per theme. Derived with a guard
 * rather than asserted, so it cannot silently disagree with the record it walks.
 */
export const THEME_NAMES: readonly ThemeName[] = Object.keys(themes).filter(
  (name): name is ThemeName => Object.hasOwn(themes, name),
);

export { canvas } from "./canvas.js";
export { editor } from "./editor.js";
