import assert from "node:assert/strict";
import { matchesGlob } from "node:path";
import { test } from "node:test";

import { projectCommand } from "../../lib/project-files.mjs";

const query = (kind) => JSON.parse(projectCommand(".", "moon", ["query", kind], true));

// Every Moon run rewrites .moon/cache, so a cached task that hashes it never replays. root:scripts-test
// once read .moon/**/* and ran in full every time.
await test("no cached task takes Moon's own cache as an input", () => {
  const { tasks } = query("tasks");
  const probe = ".moon/cache/states/probe.json";
  const checked = Object.values(tasks).flatMap((byId) => Object.values(byId));
  assert.ok(checked.length > 0, "no tasks found");
  for (const task of checked) {
    if (task.options.cache === false) continue;
    const globs = Object.keys(task.inputGlobs ?? {});
    const covered = globs.some((glob) => !glob.startsWith("!") && matchesGlob(probe, glob));
    const excluded = globs.some(
      (glob) => glob.startsWith("!") && matchesGlob(probe, glob.slice(1)),
    );
    assert.ok(!covered || excluded, `${task.target} hashes .moon/cache through its inputs`);
  }
});
