import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../../server/auth.js";

export const Route = createFileRoute("/(auth)/callback")({
  server: { handlers: { GET: auth.completeSignIn } },
});
