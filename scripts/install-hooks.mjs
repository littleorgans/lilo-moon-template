import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Every linked worktree shares the main checkout's .git/hooks, and lefthook writes the installing
// checkout's node_modules path into each hook. An install from a linked worktree would point every
// checkout's hooks at that worktree, so install only where the Git directory is the common one.
function gitPath(flag) {
  const result = spawnSync("git", ["rev-parse", flag], { encoding: "utf8" });
  // Git may print the path relative to the working directory; resolve it here rather than with
  // --path-format=absolute, which Git before 2.31 echoes back as if it were a revision.
  return result.status === 0 ? resolve(result.stdout.trim()) : null;
}

const gitDir = gitPath("--git-dir");
if (gitDir === null) {
  process.stdout.write("Git hooks not installed: not inside a Git repository.\n");
} else if (gitDir !== gitPath("--git-common-dir")) {
  process.stdout.write(
    "Git hooks not installed: linked worktrees use the main checkout's hooks.\n",
  );
} else {
  const result = spawnSync("lefthook", ["install"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
