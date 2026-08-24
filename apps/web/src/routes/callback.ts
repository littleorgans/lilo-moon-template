import { createFileRoute } from "@tanstack/react-router";

import { completeSignIn } from "../server/handlers.js";

export const Route = createFileRoute("/callback")({
  server: { handlers: { GET: completeSignIn } },
});
