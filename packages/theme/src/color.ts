/**
 * The value grammar for theme tokens, deliberately closed.
 *
 * Theme values end up inside generated CSS text and inline style properties. A value that could
 * carry `;` or `}` would escape its declaration and inject rules, so rather than trying to
 * enumerate what is dangerous, these accept only what the themes actually use: oklch, and hex for
 * escape hatches. Widening the grammar is a deliberate edit here, not a validator relaxation.
 */
const OKLCH = /^oklch\(\s*\d*\.?\d+%?\s+\d*\.?\d+\s+\d*\.?\d+(?:\s*\/\s*\d*\.?\d+%?)?\s*\)$/;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isColor(value: string): boolean {
  return OKLCH.test(value) || HEX.test(value);
}

/** A bare CSS length in rem or px, or zero. All the radius scale needs. */
const RADIUS = /^(?:0|\d*\.?\d+(?:rem|px))$/;

export function isRadius(value: string): boolean {
  return RADIUS.test(value);
}

/**
 * Theme names become `[data-theme="name"]` selectors and file-adjacent identifiers, so they get
 * the same closed treatment as values.
 */
const THEME_NAME = /^[a-z][a-z0-9-]*$/;

export function isThemeName(value: string): boolean {
  return THEME_NAME.test(value);
}
