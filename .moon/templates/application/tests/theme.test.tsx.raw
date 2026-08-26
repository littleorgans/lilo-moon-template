import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../src/router.js";
import { rootLoader } from "../src/routes/__root.js";
import { setThemeResponse } from "../src/server/theme.js";

function themePost(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const body = new URLSearchParams(fields);
  return new Request("https://example.test/api/theme", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  });
}

function setCookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("setThemeResponse", () => {
  it("applies the submitted half and keeps the other from the cookie", async () => {
    const response = await setThemeResponse({
      request: themePost({ mode: "dark" }, { cookie: "theme=light:canvas" }),
    });
    expect(response.status).toBe(303);
    expect(setCookieOf(response)).toContain("theme=dark:canvas");
  });

  it("starts from the default when there is no cookie", async () => {
    const response = await setThemeResponse({ request: themePost({ theme: "canvas" }) });
    expect(setCookieOf(response)).toContain("theme=light:canvas");
  });

  // Form fields are attacker-controlled; nothing invalid may become the cookie.
  it("ignores values that validate against nothing", async () => {
    const response = await setThemeResponse({
      request: themePost({ mode: "sepia", theme: "nope" }, { cookie: "theme=dark:canvas" }),
    });
    expect(setCookieOf(response)).toContain("theme=dark:canvas");
  });

  it("redirects back to a same-origin referer, path and query intact", async () => {
    const response = await setThemeResponse({
      request: themePost({ mode: "dark" }, { referer: "https://example.test/app?tab=2" }),
    });
    expect(response.headers.get("location")).toBe("/app?tab=2");
  });

  // A redirect target taken from a request header is an open redirect unless the origin matches.
  it("refuses a cross-origin or malformed referer", async () => {
    const responses = await Promise.all(
      ["https://evil.test/phish", "not a url"].map((referer) =>
        setThemeResponse({ request: themePost({ mode: "dark" }, { referer }) }),
      ),
    );
    for (const response of responses) {
      expect(response.headers.get("location")).toBe("/theme");
    }
  });

  it("sets a year-long, lax, site-wide cookie", async () => {
    const cookie = setCookieOf(await setThemeResponse({ request: themePost({ mode: "dark" }) }));
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("the theme preference on <html>", () => {
  it("root loader falls back to the default when the server function cannot run", async () => {
    // Outside a Start context the server function throws; the fallback is the no-cookie state.
    await expect(rootLoader()).resolves.toEqual({ mode: "light", theme: "editor" });
  });

  it("root loader passes a live preference through", async () => {
    await expect(
      rootLoader(() => Promise.resolve({ mode: "dark", theme: "canvas" })),
    ).resolves.toEqual({ mode: "dark", theme: "canvas" });
  });

  it("stamps html with the default data-mode and data-theme", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain('data-mode="light"');
    expect(html).toContain('data-theme="editor"');
  });
});

describe("the theme lab route", () => {
  it("renders the lab with the switcher posting to the theme route", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/theme"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Theme lab");
    expect(html).toContain('action="/api/theme"');
    expect(html).toContain('data-token="background"');
  });

  it("registers the api route", () => {
    const router = getRouter();

    expect(router.routesByPath["/api/theme"]).toBeDefined();
  });
});
