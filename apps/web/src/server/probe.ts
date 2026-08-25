import { groupBy } from "@lilo-moon/collections";

import { TASKS } from "../tasks.js";

/**
 * Answers "is this really running on the server, and is the workspace package really linked".
 *
 * `processId` is the proof: a value the client cannot invent. `doneCount` is computed through
 * `@lilo-moon/collections` rather than a literal, so the response changes if that package stops
 * resolving, which is the failure this route exists to catch.
 */
export function createProbeResponse(): Response {
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
