import { createFileRoute } from "@tanstack/react-router";

import { startSignIn } from "../server/handlers.js";

export const Route = createFileRoute("/api/auth/start")({
  server: { handlers: { GET: startSignIn } },
});
