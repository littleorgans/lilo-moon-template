import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../src/router.js";

describe("TanStack Start", () => {
  it("constructs the generated route tree", () => {
    const router = getRouter();

    expect(router.routesByPath["/"]).toBeDefined();
  });

  it("renders the signed-out route through the router", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("Task board");
    expect(html).toContain("Continue with Google");
  });

  // Sign-in must be a real navigation. The route it points at sets the state cookie before handing
  // the browser to the provider, and a fetch could not do that.
  it("starts sign-in with a link to the server route, not a fetch", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    await router.load();

    expect(renderToStaticMarkup(<RouterProvider router={router} />)).toContain(
      'href="/api/auth/start"',
    );
  });

  it("renders the code entry page through the router, quiet on a fresh visit", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/verify-email"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain('action="/api/auth/email/verify"');
    expect(html).not.toContain("did not work");
  });

  it("says a refused code did not work when the verify handler sends retry", async () => {
    const router = getRouter();
    router.update({
      history: createMemoryHistory({ initialEntries: ["/verify-email?retry=true"] }),
    });

    await router.load();

    expect(renderToStaticMarkup(<RouterProvider router={router} />)).toContain("did not work");
  });

  it("renders the session-ended notice when the signed-in loader sends one here", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/?ended=true"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Your session ended");
    // Both ways in survive the notice: this failure is the kind signing in again does fix.
    expect(html).toContain('href="/api/auth/start"');
  });

  // The screen for a token that verified and then made no sense. Reached through the router so the
  // route, not just the view, is proven to offer no way back to a sign-in button.
  it("renders the session-error route with no sign-in control at all", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/session-error"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("wrong on our side");
    expect(html).not.toContain("/api/auth/");
  });

  it("registers the callback and the signed-in route", () => {
    const router = getRouter();

    expect(router.routesByPath["/callback"]).toBeDefined();
    expect(router.routesByPath["/app"]).toBeDefined();
  });
});
