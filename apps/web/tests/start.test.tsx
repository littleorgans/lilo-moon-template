import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../src/router.js";
import { createProbeResponse } from "../src/routes/api.probe.js";

describe("TanStack Start", () => {
  it("constructs the generated route tree", () => {
    const router = getRouter();

    expect(router.routesByPath["/api/probe"]).toBeDefined();
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

  it("registers the callback and the signed-in route", () => {
    const router = getRouter();

    expect(router.routesByPath["/callback"]).toBeDefined();
    expect(router.routesByPath["/app"]).toBeDefined();
  });

  it("computes the probe response in the server process", async () => {
    const response = createProbeResponse();
    const body: unknown = await response.json();

    expect(body).toEqual({
      computedAt: expect.any(String),
      doneCount: 2,
      processId: process.pid,
    });
  });
});
