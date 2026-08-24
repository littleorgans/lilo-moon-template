import { callbackRoute } from "@lilo-moon/auth-tanstack";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth.js";

export const Route = createFileRoute("/callback")(callbackRoute(auth));
