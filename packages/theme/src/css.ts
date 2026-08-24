import { isColor, isRadius, isThemeName } from "./color.js";
import { COLOR_TOKENS } from "./contract.js";
import type { Palette, ProductTheme } from "./contract.js";

export interface RenderOptions {
  /** The theme painted at `:root`, so markup with no `data-theme` attribute gets it. */
  readonly defaultTheme: string;
}

/**
 * CSS text is assembled by concatenation, so any value that escaped the color grammar could close
 * its declaration and inject rules. The themes are typechecked, but a string type cannot prove its
 * content; refusing here is what makes the generated artifact trustworthy by construction.
 */
function checkedValue(themeName: string, path: string, value: string, valid: boolean): string {
  if (!valid) {
    throw new Error(
      `Theme "${themeName}" has an invalid value at ${path}: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function declarations(themeName: string, mode: string, palette: Palette, radius: string): string {
  const lines = COLOR_TOKENS.map(
    (token) =>
      `  --${token}: ${checkedValue(themeName, `${mode}.${token}`, palette[token], isColor(palette[token]))};`,
  );
  lines.push(`  --radius: ${checkedValue(themeName, "radius", radius, isRadius(radius))};`);
  return lines.join("\n");
}

function block(selector: string, body: string): string {
  return `${selector} {\n${body}\n}`;
}

/**
 * The Tailwind v4 side of the contract: expose each variable to utility generation and derive the
 * radius scale from the single base value, both in shadcn's expected shape. Static apart from the
 * token list, and emitted from the same list the palettes are checked against so the two halves
 * cannot disagree.
 */
function themeInline(): string {
  const colors = COLOR_TOKENS.map((token) => `  --color-${token}: var(--${token});`);
  const radii = [
    "  --radius-sm: calc(var(--radius) - 4px);",
    "  --radius-md: calc(var(--radius) - 2px);",
    "  --radius-lg: var(--radius);",
    "  --radius-xl: calc(var(--radius) + 4px);",
  ];
  return block("@theme inline", [...colors, ...radii].join("\n"));
}

/**
 * Renders every theme into one stylesheet: the default theme at `:root` and `.dark`, and every
 * theme (the default included) under `[data-theme="name"]`, with dark handled whether the mode
 * class sits on the same element or an ancestor. Mode is a viewer preference and theme a product
 * identity, so the two selectors compose instead of multiplying into named combinations.
 */
export function renderThemesCss(
  themes: Readonly<Record<string, ProductTheme>>,
  options: RenderOptions,
): string {
  const defaultTheme = themes[options.defaultTheme];
  if (defaultTheme === undefined) {
    throw new Error(`Default theme "${options.defaultTheme}" is not in the theme set.`);
  }

  const blocks = [
    block(
      ":root",
      declarations(options.defaultTheme, "light", defaultTheme.light, defaultTheme.radius),
    ),
    block(
      ".dark",
      declarations(options.defaultTheme, "dark", defaultTheme.dark, defaultTheme.radius),
    ),
  ];

  for (const [name, theme] of Object.entries(themes)) {
    if (!isThemeName(name)) {
      throw new Error(`Theme name ${JSON.stringify(name)} cannot become a data-theme selector.`);
    }
    blocks.push(
      block(`[data-theme="${name}"]`, declarations(name, "light", theme.light, theme.radius)),
      block(
        `.dark[data-theme="${name}"],\n.dark [data-theme="${name}"]`,
        declarations(name, "dark", theme.dark, theme.radius),
      ),
    );
  }

  blocks.push(themeInline());
  return blocks.join("\n\n") + "\n";
}
