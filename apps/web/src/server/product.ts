/**
 * What this application says about itself, in one place, so a product replaces one file rather
 * than hunting for the reference app's name across its routes.
 *
 * Plain data with no imports, because the routes render it in the browser as well as on the
 * server. This is public composition data, not a server-only module; never add secrets or service
 * imports here. `server/` names ownership, not a compiler boundary. The views take it as props.
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
 * The reference lab is development-only by default. A product can opt in at build time with
 * VITE_ENABLE_THEME_LAB=true; this public flag is identical in the SSR and browser bundles.
 */
export const SHOW_THEME_LAB: boolean =
  import.meta.env.DEV || import.meta.env["VITE_ENABLE_THEME_LAB"] === "true";
