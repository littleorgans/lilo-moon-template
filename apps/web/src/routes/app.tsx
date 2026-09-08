import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { loadWorkspaceOrRedirect } from "../features/workspace/server/load-workspace.js";
import { WorkspacePage } from "../features/workspace/workspace-page.js";

// Keep the Start server boundary visible to the compiler; feature code owns the loader behavior.
const loadWorkspace = createServerFn({ method: "GET" }).handler(
  async () => await loadWorkspaceOrRedirect(),
);

export const Route = createFileRoute("/app")({
  loader: () => loadWorkspace(),
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  return <WorkspacePage {...Route.useLoaderData()} />;
}
