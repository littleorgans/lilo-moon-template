import { createFileRoute } from "@tanstack/react-router";

import { endSession } from "../server/handlers.js";

export const Route = createFileRoute("/api/auth/signout")({
  server: { handlers: { GET: endSession } },
});
