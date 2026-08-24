import { isColor, isRadius } from "./color.js";
import { COLOR_TOKENS } from "./contract.js";
import type { ColorToken, Palette, ProductTheme } from "./contract.js";

/**
 * One thing wrong with a candidate theme. `path` is where (`"light.primary"`, `"radius"`), and
 * `reason` is a value rather than prose so a theme editor can render its own messages per field.
 */
export interface ThemeIssue {
  readonly path: string;
  readonly reason:
    | "not-an-object"
    | "unknown-key"
    | "missing"
    | "not-a-string"
    | "not-a-color"
    | "not-a-radius";
}

export type ThemeValidation =
  | { readonly ok: true; readonly theme: ProductTheme }
  | { readonly ok: false; readonly issues: readonly ThemeIssue[] };

// Copies an unknown object's own enumerable entries through Reflect.get, which is what earns the
// Record type without an assertion. The same honesty rule as `stringProperty` in packages/auth.
function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    copy[key] = Reflect.get(value, key);
  }
  return copy;
}

// The proof the compiler accepts in place of a cast: a partial palette with every token present is
// a complete one.
function isComplete(
  palette: Partial<Record<ColorToken, string>>,
): palette is Record<ColorToken, string> {
  return COLOR_TOKENS.every((token) => typeof palette[token] === "string");
}

function paletteIssues(path: string, value: unknown, issues: ThemeIssue[]): Palette | null {
  const candidate = record(value);
  if (candidate === null) {
    issues.push({ path, reason: "not-an-object" });
    return null;
  }
  const known = new Set<string>(COLOR_TOKENS);
  for (const key of Object.keys(candidate)) {
    if (!known.has(key)) issues.push({ path: `${path}.${key}`, reason: "unknown-key" });
  }
  const palette: Partial<Record<ColorToken, string>> = {};
  for (const token of COLOR_TOKENS) {
    const entry = candidate[token];
    if (entry === undefined) {
      issues.push({ path: `${path}.${token}`, reason: "missing" });
    } else if (typeof entry !== "string") {
      issues.push({ path: `${path}.${token}`, reason: "not-a-string" });
    } else if (!isColor(entry)) {
      issues.push({ path: `${path}.${token}`, reason: "not-a-color" });
    } else {
      palette[token] = entry;
    }
  }
  // Completeness alone decides: only values that passed every check were assigned, so a complete
  // palette is exactly one that contributed no issues.
  return isComplete(palette) ? palette : null;
}

/**
 * Parses untrusted input into a `ProductTheme`, collecting every issue rather than stopping at the
 * first, because the caller is a theme editor and a person fixing a form wants the whole list.
 * User themes are runtime data (a row, eventually), and this is their boundary: nothing past here
 * handles an unvalidated value.
 */
export function validateTheme(value: unknown): ThemeValidation {
  const issues: ThemeIssue[] = [];
  const candidate = record(value);
  if (candidate === null) {
    return { ok: false, issues: [{ path: "", reason: "not-an-object" }] };
  }

  for (const key of Object.keys(candidate)) {
    if (key !== "light" && key !== "dark" && key !== "radius") {
      issues.push({ path: key, reason: "unknown-key" });
    }
  }

  const light = paletteIssues("light", candidate["light"], issues);
  const dark = paletteIssues("dark", candidate["dark"], issues);

  const radius = candidate["radius"];
  if (radius === undefined) {
    issues.push({ path: "radius", reason: "missing" });
  } else if (typeof radius !== "string") {
    issues.push({ path: "radius", reason: "not-a-string" });
  } else if (!isRadius(radius)) {
    issues.push({ path: "radius", reason: "not-a-radius" });
  }

  if (issues.length > 0 || light === null || dark === null || typeof radius !== "string") {
    return { ok: false, issues };
  }
  return { ok: true, theme: { light, dark, radius } };
}
