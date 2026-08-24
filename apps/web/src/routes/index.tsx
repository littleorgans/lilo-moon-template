import { createFileRoute } from "@tanstack/react-router";

import { App } from "../app.js";

export const Route = createFileRoute("/")({
  component: App,
});
