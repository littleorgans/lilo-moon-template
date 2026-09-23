import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "../../src/router.js";
import { rootLoader } from "../../src/routes/__root.js";
import * as product from "../../src/server/product.js";
import { setThemeResponse, themeCookieName } from "../../src/server/theme.js";

const origin = "https://example.test";

function themePost(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const body = new URLSearchParams(fields);
  return new Request(`${origin}/api/theme`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers },
  });
}

function setCookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("setThemeResponse", () => {
  it("applies the submitted half and keeps the other from the cookie", async () => {
    const response = await setThemeResponse(
      {
        request: themePost(
          { mode: "dark" },
          { cookie: "theme_https%3A%2F%2Fexample.test=light:canvas" },
        ),
      },
      origin,
    );
    expect(response.status).toBe(303);
    expect(setCookieOf(response)).toContain("theme_https%3A%2F%2Fexample.test=dark:canvas");
  });

  it("starts from the default when there is no cookie", async () => {
    const response = await setThemeResponse({ request: themePost({ theme: "canvas" }) }, origin);
    expect(setCookieOf(response)).toContain("theme_https%3A%2F%2Fexample.test=light:canvas");
  });

  // Form fields are attacker-controlled; nothing invalid may become the cookie.
  it("ignores values that validate against nothing", async () => {
    const response = await setThemeResponse(
      {
        request: themePost(
          { mode: "sepia", theme: "nope" },
          { cookie: "theme_https%3A%2F%2Fexample.test=dark:canvas" },
        ),
      },
      origin,
    );
    expect(setCookieOf(response)).toContain("theme_https%3A%2F%2Fexample.test=dark:canvas");
  });

  it("redirects back to a same-origin referer, path and query intact", async () => {
    const response = await setThemeResponse(
      {
        request: themePost({ mode: "dark" }, { referer: "https://example.test/app?tab=2" }),
      },
      origin,
    );
    expect(response.headers.get("location")).toBe("/app?tab=2");
  });

  // A redirect target taken from a request header is an open redirect unless the origin matches.
  // Behind a TLS-terminating proxy the request arrives as http: while the page, and its referer,
  // are https:. The configured origin decides, so the switch still lands back on the page.
  it("sends the switch back to the page behind a proxy that rewrites the scheme", async () => {
    const response = await setThemeResponse(
      {
        request: new Request("http://internal:3000/api/theme", {
          method: "POST",
          body: new URLSearchParams({ mode: "dark" }),
          headers: { origin, referer: `${origin}/app?tab=2` },
        }),
      },
      origin,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/app?tab=2");
  });

  it("refuses a cross-origin or malformed referer", async () => {
    const responses = await Promise.all(
      ["https://evil.test/phish", "not a url"].map((referer) =>
        setThemeResponse({ request: themePost({ mode: "dark" }, { referer }) }, origin),
      ),
    );
    for (const response of responses) {
      expect(response.headers.get("location")).toBe("/");
    }
  });

  // A page on another origin must not rewrite a visitor's preference. No Origin is refused too,
  // exactly as sign-out refuses it.
  it.each([
    ["another origin", themePost({ mode: "dark" }, { origin: "https://evil.test" })],
    [
      "no Origin",
      new Request(`${origin}/api/theme`, {
        method: "POST",
        body: new URLSearchParams({ mode: "dark" }),
      }),
    ],
  ])("refuses %s with 403 and leaves the preference alone", async (_, request) => {
    const response = await setThemeResponse({ request }, origin);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets a year-long, lax, site-wide cookie", async () => {
    const cookie = setCookieOf(
      await setThemeResponse({ request: themePost({ mode: "dark" }) }, origin),
    );
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

  // Vitest runs with DEV set, so the case a production build takes is forced here. The built
  // server's 404 is asserted end to end by root:published-shape.
  describe("outside the dev server", () => {
    afterEach(() => {
      vi.doUnmock("../../src/server/product.js");
      vi.resetModules();
    });

    it("answers /theme as not found and renders no lab", async () => {
      vi.resetModules();
      vi.doMock("../../src/server/product.js", () => ({ ...product, SHOW_THEME_LAB: false }));
      const { getRouter: productionRouter } = await import("../../src/router.js");
      const router = productionRouter();
      router.update({ history: createMemoryHistory({ initialEntries: ["/theme"] }) });

      await router.load();

      const html = renderToStaticMarkup(<RouterProvider router={router} />);
      expect(router.state.matches.some((match) => match.status === "notFound")).toBe(true);
      expect(html).not.toContain("Theme lab");
    });
  });

  it("registers the api route", () => {
    const router = getRouter();

    expect(router.routesByPath["/api/theme"]).toBeDefined();
  });
});

it("stores different preference cookies for local apps on different ports", async () => {
  const names = await Promise.all(
    [5199, 5200].map(async (port) => {
      const url = `http://localhost:${port}/api/theme`;
      const response = await setThemeResponse(
        {
          request: new Request(url, {
            method: "POST",
            headers: { origin: new URL(url).origin },
            body: new URLSearchParams({ mode: "dark" }),
          }),
        },
        new URL(url).origin,
      );
      expect(response.headers.get("set-cookie")).toContain(`${themeCookieName(url)}=dark:editor`);
      return response.headers.get("set-cookie");
    }),
  );
  expect(names[0]).not.toBe(names[1]);
});
