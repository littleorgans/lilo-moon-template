import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../../../server/auth.js";

export const Route = createFileRoute("/api/auth/start")({
  server: { handlers: { GET: auth.startSignIn } },
});
