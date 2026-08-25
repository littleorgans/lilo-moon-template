import { describe, expect, it } from "vitest";

import { workspaceSourceConfig } from "../src/index.js";

const serve = workspaceSourceConfig({ command: "serve", mode: "development" });
const build = workspaceSourceConfig({ command: "build", mode: "production" });

describe("workspaceSourceConfig", () => {
  // Serving from source is a development affordance. A build that kept the condition would resolve
  // packages to files no consumer of the published package ever gets, and prove nothing.
  it("adds the source condition when serving and not when building", () => {
    expect(serve.resolve?.conditions).toContain("@lilo-moon/source");
    expect(build.resolve?.conditions).not.toContain("@lilo-moon/source");
  });

  // The trap this package exists for. Start and Nitro replace the top-level conditions rather than
  // extending them, so a config that sets them once serves live source to the browser and built
  // output to the server renderer, and the two disagree without saying so.
  it("sets the condition on the SSR environment as well as the client", () => {
    expect(serve.ssr?.resolve?.conditions).toContain("@lilo-moon/source");
    expect(build.ssr?.resolve?.conditions).not.toContain("@lilo-moon/source");
  });

  // Replacing the defaults rather than extending them is how a config loses `browser` or `node`
  // and starts resolving the wrong half of a dual package.
  it("keeps the defaults it is extending", () => {
    expect(serve.resolve?.conditions?.length).toBeGreaterThan(1);
    expect(serve.ssr?.resolve?.conditions?.length).toBeGreaterThan(1);
  });

  // Derived from the filesystem, so a package added tomorrow is excluded without anyone editing a
  // list. Asserted against packages that exist rather than a count, which would break on every
  // addition and teach the next person to update the number rather than read the test.
  it("excludes every workspace package from prebundling", () => {
    expect(serve.optimizeDeps?.exclude).toEqual(expect.arrayContaining(["@lilo-moon/ui"]));
    expect(serve.optimizeDeps?.exclude).toEqual(expect.arrayContaining(["@lilo-moon/auth"]));
    expect(serve.optimizeDeps?.exclude).toEqual(expect.arrayContaining(["@lilo-moon/vite-config"]));
  });
});
