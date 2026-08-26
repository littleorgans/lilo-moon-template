import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The application template carries near-copies of apps/web, and nothing else keeps them honest.
 *
 * Every `.raw` file under the template is byte-for-byte the file `apps/web` runs, by definition:
 * `.raw` means "no templating", so any difference is drift, and drift here surfaces as a broken
 * first `just ci` in the next generated application rather than as a failure in this repo. `.tera`
 * files are excluded because they exist to differ: they carry the name and port substitutions.
 *
 * The allowlist names the deliberate differences, each with its reason, so a new difference has to
 * be argued into this file rather than accumulating silently.
 */
const templateRoot = ".moon/templates/application";
const applicationRoot = "apps/web";

const deliberateDifferences = new Map([
  // The template generates no product, apps/web renders its task board here.
  ["src/components/signed-in-route.tsx", "the template omits the demo product"],
  ["tests/signed-in-route.test.tsx", "the template omits the demo product"],
  // Template-only: apps/web is never deployed, so it serves no robots.txt.
  ["public/robots.txt", "template-only, apps/web serves none"],
]);

function rawFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rawFiles(path);
    return path.endsWith(".raw") ? [path] : [];
  });
}

const failures = [];

for (const templatePath of rawFiles(templateRoot)) {
  const counterpart = relative(templateRoot, templatePath).slice(0, -".raw".length);
  if (deliberateDifferences.has(counterpart)) continue;

  const applicationPath = join(applicationRoot, counterpart);
  if (!existsSync(applicationPath)) {
    failures.push(`${templatePath} has no counterpart at ${applicationPath}`);
    continue;
  }
  if (!readFileSync(templatePath).equals(readFileSync(applicationPath))) {
    failures.push(`${templatePath} differs from ${applicationPath}`);
  }
}

for (const [counterpart, reason] of deliberateDifferences) {
  if (!existsSync(join(templateRoot, `${counterpart}.raw`))) {
    failures.push(`allowlist entry ${counterpart} (${reason}) names no template file; remove it`);
  }
}

if (failures.length > 0) {
  console.error("The application template has drifted from apps/web:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("Copy the changed file into the template (or apps/web), or record the");
  console.error("difference as deliberate in scripts/template-drift.mjs.");
  process.exit(1);
}

process.stdout.write("Application template matches apps/web.\n");
