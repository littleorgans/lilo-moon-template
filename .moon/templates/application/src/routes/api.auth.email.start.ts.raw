import { postHandlers } from "@lilo-moon/auth-tanstack";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth.js";

export const Route = createFileRoute("/api/auth/email/start")({
  server: { handlers: postHandlers(auth.sendEmailCode) },
});
