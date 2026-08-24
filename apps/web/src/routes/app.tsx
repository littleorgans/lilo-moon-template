import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { SignedInRoute } from "../components/signed-in-panel.js";
import { loadSignedOrRedirect } from "../server/signed-in.js";
import type { SignedInView } from "../server/signed-in.js";

/**
 * A server function, declared here rather than beside the loader it calls.
 *
 * `createServerFn` is the client/server boundary the Start plugin compiles against: it strips the
 * handler out of the client build. Wrapping it in an ordinary function in another module defeats
 * that, and the server-only imports behind it leak into the client graph. The build refuses this,
 * which is how the placement was settled.
 */
// Called with no arguments so the loader takes its live dependencies. The server function's
// signature has no room for the test seams, which is what keeps them out of the running server.
const loadSigned = createServerFn({ method: "GET" }).handler(
  async () => await loadSignedOrRedirect(),
);

/** Exported so the wiring is reachable from a test rather than only from a running server. */
export async function appLoader(): Promise<SignedInView> {
  return await loadSigned();
}

export const Route = createFileRoute("/app")({
  loader: appLoader,
  component: SignedInRoute,
});
