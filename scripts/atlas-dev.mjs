// Runs `atlas migrate lint` or `diff` against a dev database this repo manages on a pinned port.
// Atlas's own `docker://` driver publishes its container to a random host port with no way to pin
// one, and that random bind collided with another container on this machine. Routing Atlas through
// the shared helper gives it the same pinned-port, one-lifecycle treatment as every other database
// task. The dev database must be empty scratch space, which a fresh container is.
import { dockerIsAvailable, run, withPostgres } from "./lib/postgres-container.mjs";

const mode = process.argv[2];
if (mode !== "lint" && mode !== "diff") {
  console.error("Usage: node scripts/atlas-dev.mjs <lint|diff>");
  process.exit(2);
}

// Local checks are a fast subset and announce a missing Docker daemon. CI is authoritative: there,
// Docker or Atlas failure fails the gate.
if (mode === "lint" && !process.env.CI && !dockerIsAvailable()) {
  console.error("Atlas lint skipped locally: Docker is unavailable; CI will run it.");
  process.exit(0);
}

function devUrl(databaseUrl) {
  return `${databaseUrl}&search_path=public`;
}

if (mode === "lint") {
  const base = process.env.MOON_BASE;
  const selector = base === undefined || base === "" ? "--latest=1" : `--git-base=${base}`;
  await withPostgres("atlas-lint", (databaseUrl) => {
    run("atlas", [
      "migrate",
      "lint",
      "--dir",
      "file://db/migrations",
      "--dev-url",
      devUrl(databaseUrl),
      selector,
    ]);
  });
} else {
  await withPostgres("atlas-diff", (databaseUrl) => {
    run("atlas", [
      "migrate",
      "diff",
      "--dir",
      "file://db/migrations",
      "--to",
      "file://db/schema.sql",
      "--dev-url",
      devUrl(databaseUrl),
    ]);
  });
}
