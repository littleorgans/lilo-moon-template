/**
 * The color slots every product theme must fill. The names are shadcn's, verbatim, because shadcn
 * components read these variables and the names are therefore not ours to choose. Everything that
 * walks a palette (the CSS renderer, the applier, the validator) iterates this list, so adding a
 * token here is the whole change: a theme missing it fails typecheck, and the generated CSS, the
 * runtime applier and the validator pick it up without edits.
 */
export const COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** One mode's worth of color values. Complete by construction: a missing token is a type error. */
export type Palette = Readonly<Record<ColorToken, string>>;

/**
 * A product theme carries both modes plus the base radius. Light and dark travel together because
 * mode is a viewer preference while the theme is a product identity, and every product must be
 * usable in both.
 */
export interface ProductTheme {
  readonly light: Palette;
  readonly dark: Palette;
  /** The base corner radius. shadcn derives its radius scale from this single value. */
  readonly radius: string;
}
