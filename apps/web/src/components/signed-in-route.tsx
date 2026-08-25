import { SignedInPanel } from "@lilo-moon/views/signed-in-panel";
import { getRouteApi } from "@tanstack/react-router";

import { TaskBoard } from "./task-board.js";

// Resolved once at module scope: a hook selected off a fresh object on every render is a different
// function each time, which is exactly what the rules of hooks forbid.
const routeApi = getRouteApi("/app");

/**
 * The route's component.
 *
 * Reads the loader's data through `getRouteApi` rather than importing the route, which would be a
 * cycle: the route names this component. The panel itself lives in `@lilo-moon/views` and takes its
 * data as props; what is left here is the wiring to this application's loader and product.
 */
export function SignedInRoute() {
  return (
    <SignedInPanel {...routeApi.useLoaderData()}>
      <TaskBoard />
    </SignedInPanel>
  );
}
