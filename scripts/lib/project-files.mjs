import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export function projectEnvironment() {
  // A child workspace runs its own setup, including development-only Moon tasks.
  // CI detection uses variable presence, so setting these flags to "false" is insufficient.
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("MOON_") &&
        !key.startsWith("PROTO_") &&
        !key.startsWith("WORKOS_") &&
        ![
          "CI",
          "GITHUB_ACTIONS",
          "DATABASE_URL",
          "GIT_DIR",
          "GIT_WORK_TREE",
          "GIT_INDEX_FILE",
        ].includes(key),
    ),
  );
}

export function projectCommand(cwd, command, args, capture = false) {
  return execFileSync(command, args, {
    cwd,
    timeout: 10 * 60_000,
    killSignal: "SIGKILL",
    env: projectEnvironment(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

export function git(root, args) {
  return projectCommand(root, "git", args, true).trimEnd();
}

export function commitProject(root, message) {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    message,
  ]);
}

export function initializeProject(root, message) {
  git(root, ["init", "--initial-branch=main"]);
  commitProject(root, message);
}

export function writeJson(path, value, options = {}) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, options);
}
