import { postHandlers } from "@littleorgans/auth-tanstack";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../../../../server/auth.js";

export const Route = createFileRoute("/api/auth/email/start")({
  server: { handlers: postHandlers(auth.sendEmailCode) },
});
