import { emailVerifyRoute } from "@lilo-moon/auth-tanstack";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth.js";

export const Route = createFileRoute("/api/auth/email/verify")(emailVerifyRoute(auth));
