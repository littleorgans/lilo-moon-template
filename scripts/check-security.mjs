import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cli, run } from "secretlint/cli";

const workspaceFile = resolve("pnpm-workspace.yaml");
const today = new Date().toISOString().slice(0, 10);

function fail(message) {
  console.error(`Audit ignore policy: ${message}`);
  process.exit(1);
}

function isBlankOrComment(line) {
  return line.trim() === "" || /^\s*#/.test(line);
}

function ignoreEntries(workspaceYaml) {
  const lines = workspaceYaml.split(/\r?\n/);
  let auditIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const audit = /^audit\s*:\s*(.*?)\s*$/.exec(lines[index]);
    if (audit === null) {
      continue;
    }
    if (auditIndex !== -1) {
      fail(`${workspaceFile}:${index + 1} duplicates audit`);
    }
    if (audit[1] !== "" && !audit[1].startsWith("#")) {
      fail(`${workspaceFile}:${index + 1} audit must use a block mapping`);
    }
    auditIndex = index;
  }

  if (auditIndex === -1) {
    return [];
  }

  let auditEnd = lines.length;
  for (let index = auditIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isBlankOrComment(line)) {
      continue;
    }
    if (!/^\s/.test(line)) {
      auditEnd = index;
      break;
    }
  }

  let ignoreIndex = -1;
  for (let index = auditIndex + 1; index < auditEnd; index += 1) {
    const line = lines[index];
    const trimmed = line.trimStart();
    if (!/^ignore\s*:/.test(trimmed)) {
      continue;
    }
    if (line.length - trimmed.length !== 2) {
      fail(`${workspaceFile}:${index + 1} audit.ignore must be indented by two spaces`);
    }
    if (ignoreIndex !== -1) {
      fail(`${workspaceFile}:${index + 1} duplicates audit.ignore`);
    }
    if (!/^  ignore\s*:\s*(?:#.*)?$/.test(line)) {
      fail(
        `${workspaceFile}:${index + 1} audit.ignore must use a block list so every entry can carry its policy comment`,
      );
    }
    ignoreIndex = index;
  }

  if (ignoreIndex === -1) {
    return [];
  }

  const entries = [];
  for (let index = ignoreIndex + 1; index < auditEnd; index += 1) {
    const entry = lines[index];
    if (isBlankOrComment(entry)) {
      continue;
    }
    if (/^  \S/.test(entry)) {
      break;
    }
    if (!entry.startsWith("    - ")) {
      fail(
        `${workspaceFile}:${index + 1} audit.ignore entries must start with four spaces and "- "`,
      );
    }
    entries.push({ line: index + 1, value: entry });
  }

  if (entries.length === 0) {
    fail(`${workspaceFile}:${ignoreIndex + 1} audit.ignore must contain a block list entry`);
  }
  return entries;
}

function trackedIgnoredFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function writeSecretlintResult({ stderr, stdout }) {
  if (stdout !== null) {
    process.stdout.write(stdout);
  }
  if (stderr !== null) {
    console.error(stderr);
  }
}

async function scan(patterns, flags) {
  const result = await run(patterns, flags);
  writeSecretlintResult(result);
  return result.exitStatus;
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

const regularStatus = await scan(["**/*", "**/.*", "**/.*/**/*"], cli.flags);
const ignoredFiles = trackedIgnoredFiles();
const ignoredStatus =
  ignoredFiles.length === 0
    ? 0
    : await scan(ignoredFiles, {
        ...cli.flags,
        gitignore: false,
      });
process.exitCode = regularStatus || ignoredStatus;
