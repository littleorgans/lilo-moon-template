import type { ProductTheme } from "../contract.js";
import { canvas } from "./canvas.js";
import { editor } from "./editor.js";

/**
 * Every built-in product theme, keyed by the name that becomes its `data-theme` value. `satisfies`
 * keeps the keys inferable as literals while still forcing each entry to be a complete theme.
 */
export const themes = { editor, canvas } satisfies Record<string, ProductTheme>;

export type ThemeName = keyof typeof themes;

export { canvas } from "./canvas.js";
export { editor } from "./editor.js";
