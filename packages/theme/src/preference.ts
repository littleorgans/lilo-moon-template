import type { ThemeMode } from "./apply.js";
import { THEME_NAMES } from "./themes/index.js";
import type { ThemeName } from "./themes/index.js";

/**
 * A viewer's choice of mode and theme, the pair the stylesheet's two selector axes compose from.
 * Carried in one cookie so the server renders the right `<html>` attributes on the first byte:
 * no flash of the wrong mode, no hydration mismatch, and switching works with JavaScript off.
 */
export interface ThemePreference {
  readonly mode: ThemeMode;
  readonly theme: string;
}

/** The cookie the preference travels in. Parsed by `parseThemePreference`, written by the app. */
export const THEME_COOKIE = "theme";

/**
 * The theme painted at `:root`. The generated stylesheet and every fallback below key on this one
 * value, so changing the default is this line and a `theme:generate-css` run.
 */
export const DEFAULT_THEME_NAME: ThemeName = "editor";

/** What a visitor with no cookie gets. Light because the generated `:root` palette is light. */
export const DEFAULT_PREFERENCE: ThemePreference = { mode: "light", theme: DEFAULT_THEME_NAME };

function isThemeMode(value: string): value is ThemeMode {
  return value === "light" || value === "dark";
}

export interface ThemePreferenceOptions {
  readonly names: readonly string[];
  readonly fallback: ThemePreference;
}

export const DEFAULT_PREFERENCE_OPTIONS: ThemePreferenceOptions = {
  names: THEME_NAMES,
  fallback: DEFAULT_PREFERENCE,
};

/** The cookie value: `mode:theme`. Both halves are validated on the way back in. */
export function serializeThemePreference(preference: ThemePreference): string {
  return `${preference.mode}:${preference.theme}`;
}

/**
 * Parses a cookie value back into a preference, leniently per half: a cookie written before a
 * theme was renamed keeps its mode, and vice versa. Anything unrecognized falls back to the
 * default rather than throwing, because a stale cookie is a visitor, not an error.
 */
export function parseThemePreference(
  value: string | null | undefined,
  options: ThemePreferenceOptions = DEFAULT_PREFERENCE_OPTIONS,
): ThemePreference {
  if (value === undefined || value === null) return options.fallback;
  const [mode = "", theme = ""] = value.split(":");
  return {
    mode: isThemeMode(mode) ? mode : options.fallback.mode,
    theme: options.names.includes(theme) ? theme : options.fallback.theme,
  };
}

/**
 * Applies one submitted change to the current preference. Each switcher button submits only its
 * own field, so the other half carries over, and a value that validates against nothing (a fifth
 * mode, a theme this build does not ship) changes nothing.
 */
export function nextPreference(
  current: ThemePreference,
  mode: unknown,
  theme: unknown,
  options: ThemePreferenceOptions = DEFAULT_PREFERENCE_OPTIONS,
): ThemePreference {
  return {
    mode: typeof mode === "string" && isThemeMode(mode) ? mode : current.mode,
    theme: typeof theme === "string" && options.names.includes(theme) ? theme : current.theme,
  };
}

/**
 * Reads one cookie out of a `Cookie` request header, so a handler built on the plain `Request`
 * needs no framework. Splitting on `;` is sound because RFC 6265 forbids semicolons in values.
 */
export function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}
