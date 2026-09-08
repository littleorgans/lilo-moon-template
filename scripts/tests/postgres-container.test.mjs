import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresIdentity } from "../lib/postgres-container.mjs";

await test("Postgres names and default ports belong to the checkout", () => {
  const one = postgresIdentity("/one/project");
  const two = postgresIdentity("/two/project");
  assert.deepEqual(one, postgresIdentity("/one/project"));
  assert.notEqual(one.container, two.container);
  assert.notEqual(one.port, two.port);
  assert.match(one.container, /^baseline-postgres-[a-f0-9]{12}$/);
});
