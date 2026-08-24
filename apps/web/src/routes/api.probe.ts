import { groupBy } from "@lilo-moon/collections";
import { createFileRoute } from "@tanstack/react-router";

import { TASKS } from "../app.js";

export function createProbeResponse() {
  const tasksByStatus = groupBy(TASKS, (task) => task.status);
  const doneCount = [...tasksByStatus].reduce(
    (count, [status, tasks]) => (status === "done" ? count + tasks.length : count),
    0,
  );

  return Response.json({
    computedAt: new Date().toISOString(),
    doneCount,
    processId: process.pid,
  });
}

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: {
      GET: createProbeResponse,
    },
  },
});
