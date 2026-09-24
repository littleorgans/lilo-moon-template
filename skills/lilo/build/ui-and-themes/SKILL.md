---
name: ui-and-themes
description: Use and extend the @littleorgans/ui primitives, @littleorgans/views screens and @littleorgans/theme tokens, including registering Tailwind sources, deciding when a component moves from a feature into a shared package, and adding a color token or a product theme. Use when building UI in a web app from the littleorgans reference, when a Tailwind class renders unstyled, or when changing tokens, themes or the theme switcher.
---

# Use the UI and themes

Three packages, each with one job. `@littleorgans/ui` holds small primitives (shadcn components,
layout, typography) and the Tailwind entry stylesheet. `@littleorgans/views` holds composed screens
that take their labels, paths and data as props. `@littleorgans/theme` owns the color token
contract, the product themes and the CSS generated from them. Every path here is in
`littleorgans/lilo-moon-template`. Read them at the tag that matches the installed
`@littleorgans/*` version.

`docs/code-layout.md`, "Shared packages", is the layout. Where a feature's own components live is
[web-app](../web-app/SKILL.md).

## Register every source that uses Tailwind

`packages/ui/src/globals.css` imports Tailwind with `source(none)`, so Tailwind scans nothing on its
own. Each package registers its own directory, and the app registers its own:
`apps/web/src/styles.css` imports the UI stylesheet and `@littleorgans/views/sources.css`, then
adds `@source "./"`. A class used somewhere unregistered is not generated, and nothing fails: the
element renders unstyled. When that happens, look for the missing registration before touching
the component. A shared package of your own that uses Tailwind ships a `sources.css` like
`packages/views/src/sources.css`, and the app imports it.

## When a component moves

Keep a component in its feature until a second caller needs the same contract. When it moves:

- A primitive with no product meaning goes to `ui`. A screen composed of primitives goes to
  `views` under its own directory and subpath export, as `packages/views/src/sign-in/` does.
- Callers supply paths, labels and data. A shared component never imports application source or
  owns application tables.
- Wording that carries a security rule stays in the view, not a prop. The sign-in panel's
  session-ended notice names no reason, so no application can weaken it with friendlier copy.
- In a project, the first move is to the project's own `packages/`. Proposing it upstream to
  `@littleorgans/ui` or `views` is right once another project needs it, since every consumer then
  inherits it.

## Tokens and themes

- `COLOR_TOKENS` in `packages/theme/src/contract.ts` is the contract. Their names are shadcn's and
  are not ours to choose. Adding one is the whole change: every theme missing it fails typecheck,
  and the renderer, applier and validator pick it up.
- A product theme carries light and dark palettes and a radius (`ProductTheme`). Both modes are
  required, because mode is the viewer's choice and the theme is the product's identity.
- Built-in themes live in `packages/theme/src/themes/`, and `css/themes.css` is generated from
  them with `moon run theme:generate-css`. A project cannot add one without changing this
  package. Rendering a project's own theme with `renderThemesCss` is possible but has no reference
  yet, so treat it as new work and say so.
- A theme that is data, such as one a person edits, goes through `validateTheme` and then
  `applyTheme`. Never write unvalidated input into a style property.

## The preference

The mode and theme travel in a cookie named per origin (`themeCookieName` in
`apps/web/src/server/theme.ts`), so apps on different localhost ports keep separate preferences.
The switcher posts to the `setPath` it is given, `/api/theme` in the reference, which refuses
other origins before touching the cookie. The
theme lab at `/theme` is a development page: `SHOW_THEME_LAB` in `apps/web/src/server/product.ts`
keeps it out of a production build, and turning it on is a product decision made in code.

## Gates

- A theme missing a token fails `theme:typecheck`, and the app's typecheck when it defines one.
- `theme:check-css` fails when `packages/theme/css/themes.css` differs from the source.
- For this repository's packages, `root:published-shape` fails when a published primitive, a view
  or the consuming app loses its generated utilities, or a CSS source registration is missing.

A project has no gate for an unregistered source. Look at the page.
