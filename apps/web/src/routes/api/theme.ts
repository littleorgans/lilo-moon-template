import { createFileRoute } from "@tanstack/react-router";

import { postTheme } from "../../server/theme.js";

export const Route = createFileRoute("/api/theme")({
  server: {
    handlers: {
      POST: postTheme,
    },
  },
});
