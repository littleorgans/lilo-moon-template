import { DEFAULT_PREFERENCE, parseThemePreference } from "@lilo-moon/theme";
import type { ThemePreference } from "@lilo-moon/theme";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import type { ReactNode } from "react";

import { themeCookieName } from "../server/theme.js";

import stylesUrl from "../styles.css?url";

// Start compiles this server function out of the browser bundle.
const readTheme = createServerFn({ method: "GET" }).handler(() =>
  parseThemePreference(getCookie(themeCookieName(getRequest().url))),
);

/**
 * The root loader's one job: the theme preference, so `<html>` wears the right mode class and
 * `data-theme` in the server render and the first paint is already themed. Exported with the
 * server function as a seam so a test can run the loader without a Start context; the fallback is
 * also what a test environment gets, which keeps every router test on the default preference.
 */
export async function rootLoader(
  read: () => Promise<ThemePreference> = readTheme,
): Promise<ThemePreference> {
  try {
    return await read();
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export const Route = createRootRoute({
  loader: () => rootLoader(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Task board" },
    ],
    links: [{ rel: "stylesheet", href: stylesUrl }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument preference={Route.useLoaderData()}>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({
  preference,
  children,
}: Readonly<{ preference: ThemePreference; children: ReactNode }>) {
  return (
    // The stylesheet selects the mode and theme independently.
    <html lang="en" data-mode={preference.mode} data-theme={preference.theme}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
