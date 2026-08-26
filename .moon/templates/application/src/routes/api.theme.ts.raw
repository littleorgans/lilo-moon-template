import { createFileRoute } from "@tanstack/react-router";

import { setThemeResponse } from "../server/theme.js";

export const Route = createFileRoute("/api/theme")({
  server: {
    handlers: {
      POST: setThemeResponse,
    },
  },
});
