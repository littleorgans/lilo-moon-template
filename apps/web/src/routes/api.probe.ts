import { createFileRoute } from "@tanstack/react-router";

import { createProbeResponse } from "../server/probe.js";

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: {
      GET: createProbeResponse,
    },
  },
});
