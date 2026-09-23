/**
 * What this application says about itself, in one place, so a product replaces one file rather
 * than hunting for the reference app's name across its routes.
 *
 * Plain data with no imports, because the routes render it in the browser as well as on the
 * server. The views take all of it as props, so nothing here is baked into a package.
 */
export const PRODUCT = {
  /** The document title on every page, and the heading on the sign-in page. */
  name: "Workspace",
  signIn: {
    description: "Sign in to continue to your workspace.",
    /** Names the provider `auth.ts` selects, so change the two together. */
    oauthLabel: "Continue with Google",
  },
  /** Shown on `/session-error`, the one failure signing in again does not fix. */
  sessionErrorHint: "If this persists, quote the time you saw it.",
} as const;

/**
 * Whether `/theme`, the theme lab, is served. It is a reference page for working on the theme, not
 * a product page, so a production build answers it with 404 and only the dev server renders it.
 *
 * Fixed when the bundle is built rather than read from the environment: the route is matched in the
 * browser too, where there is no environment to read.
 */
export const SHOW_THEME_LAB: boolean = import.meta.env.DEV;
