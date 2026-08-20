import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cli, run } from "secretlint/cli";

const workspaceFile = resolve("pnpm-workspace.yaml");
const today = new Date().toISOString().slice(0, 10);

function fail(message) {
  console.error(`Audit ignore policy: ${message}`);
  process.exit(1);
}

function ignoreEntries(workspaceYaml) {
  const lines = workspaceYaml.split(/\r?\n/);
  const auditIndex = lines.findIndex((line) => /^audit:\s*(?:#.*)?$/.test(line));
  if (auditIndex === -1) {
    return [];
  }

  for (let index = auditIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    }
    if (!/^\s/.test(line)) {
      return [];
    }

    const ignore = /^  ignore:\s*(.*?)\s*$/.exec(line);
    if (ignore === null) {
      continue;
    }
    if (ignore[1] !== "") {
      fail("audit.ignore must use a block list so every entry can carry its policy comment");
    }

    const entries = [];
    for (index += 1; index < lines.length; index += 1) {
      const entry = lines[index];
      if (entry.trim() === "" || /^\s*#/.test(entry)) {
        continue;
      }
      if (!entry.startsWith("    - ")) {
        break;
      }
      entries.push({ line: index + 1, value: entry });
    }
    return entries;
  }

  return [];
}

const entries = ignoreEntries(readFileSync(workspaceFile, "utf8"));
const seen = new Set();

for (const entry of entries) {
  const match =
    /^    - (GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}) # expires (\d{4}-\d{2}-\d{2}): (\S.*)$/.exec(
      entry.value,
    );
  if (match === null) {
    fail(
      `${workspaceFile}:${entry.line} must be "- GHSA-xxxx-xxxx-xxxx # expires YYYY-MM-DD: reason"`,
    );
  }

  const [, advisory, expiry] = match;
  const parsedExpiry = new Date(`${expiry}T00:00:00.000Z`);
  if (Number.isNaN(parsedExpiry.valueOf()) || parsedExpiry.toISOString().slice(0, 10) !== expiry) {
    fail(`${workspaceFile}:${entry.line} has invalid expiry ${expiry}`);
  }
  if (expiry < today) {
    fail(`${workspaceFile}:${entry.line} expired on ${expiry}`);
  }
  if (seen.has(advisory)) {
    fail(`${workspaceFile}:${entry.line} duplicates ${advisory}`);
  }
  seen.add(advisory);
}

const { exitStatus, stderr, stdout } = await run(["**/*", "**/.*", "**/.*/**/*"], cli.flags);
if (stdout !== null) {
  process.stdout.write(stdout);
}
if (stderr !== null) {
  console.error(stderr);
}
process.exitCode = exitStatus;
