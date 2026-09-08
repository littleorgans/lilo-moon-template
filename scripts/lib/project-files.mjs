import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function projectEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("MOON_") &&
        !key.startsWith("PROTO_") &&
        !key.startsWith("WORKOS_") &&
        !["DATABASE_URL", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key),
    ),
  );
}

export function projectCommand(cwd, command, args, capture = false) {
  return execFileSync(command, args, {
    cwd,
    env: projectEnvironment(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

export function git(root, args) {
  return projectCommand(root, "git", args, true).trimEnd();
}

export function commitProject(root, message, amend = false) {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "commit",
    ...(amend ? ["--amend"] : []),
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

export function within(parent, path) {
  const child = relative(parent, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export function digest(...values) {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value);
  return hash.digest("hex");
}

export function fileHash(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) return null;
    const value = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path);
    return digest(
      stat.isSymbolicLink() ? "link:" : `file:${stat.mode & 0o111 ? "executable" : "regular"}:`,
      value,
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Metadata contains relative paths only. Reject escapes before opening a descendant file. */
export function projectFile(root, path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid project file path: ${path}`);
  }
  return resolve(root, path);
}
