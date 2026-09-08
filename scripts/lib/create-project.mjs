import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  commitProject,
  fileHash,
  git,
  initializeProject,
  projectCommand,
  projectEnvironment,
  within,
  writeJson,
} from "./project-files.mjs";
import { ORIGIN_FILE, registerProject, remoteUrl, templateConfig } from "./project-registry.mjs";

function destinationPath(path) {
  let existing = resolve(path);
  const missing = [];
  while (!existsSync(existing)) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

export function planProject({
  source,
  name,
  destination,
  org,
  scope = name,
  ref = "HEAD",
  remote = null,
  install = true,
}) {
  for (const [label, value] of Object.entries({ name, org, scope })) {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) {
      throw new Error(
        `${label} must contain lowercase letters, digits and internal periods, underscores or hyphens`,
      );
    }
  }
  const root = realpathSync(source);
  const target = destinationPath(destination);
  if (within(root, target) || within(target, root))
    throw new Error("Destination must be outside the template checkout");
  if (existsSync(target)) throw new Error(`Destination already exists: ${target}`);
  const revision = git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  projectCommand(
    root,
    "bash",
    ["scripts/rename-template.sh", "--validate", org, scope, name],
    true,
  );
  const config = templateConfig(root);
  const archived = JSON.parse(git(root, ["show", `${revision}:.template/config.json`]));
  if (archived.id !== config.id)
    throw new Error("Selected revision belongs to another template identity");
  return {
    source: root,
    name,
    destination: target,
    org,
    scope,
    revision,
    remote,
    install,
    templateId: config.id,
  };
}

/** Export a committed tree. Ignored files, working changes, Git history and descendants never enter it. */
export function createProject(options) {
  const plan = planProject(options);
  mkdirSync(dirname(plan.destination), { recursive: true });
  const parent = realpathSync(dirname(plan.destination));
  if (within(plan.source, parent))
    throw new Error("Destination parent resolves inside the template checkout");
  // Atomic reservation: a concurrent creator cannot reuse or replace this destination.
  mkdirSync(plan.destination);
  let initialized = false;
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", plan.revision], {
      cwd: plan.source,
      env: projectEnvironment(),
      maxBuffer: 128 * 1024 * 1024,
    });
    execFileSync("tar", ["-xf", "-", "-C", plan.destination], { input: archive });
    if (templateConfig(plan.destination).id !== plan.templateId)
      throw new Error("Selected revision belongs to another template identity");
    rmSync(join(plan.destination, ".template"), { recursive: true, force: true });
    rmSync(join(plan.destination, ORIGIN_FILE), { force: true });
    initializeProject(plan.destination, "chore: initialize project");
    projectCommand(plan.destination, "bash", [
      "scripts/rename-template.sh",
      plan.org,
      plan.scope,
      plan.name,
      ...(plan.install ? [] : ["--no-install"]),
    ]);
    if (plan.install) {
      projectCommand(plan.destination, "moon", ["sync"]);
      projectCommand(plan.destination, "moon", ["run", "root:format"]);
    }
    if (plan.remote) git(plan.destination, ["remote", "add", "origin", plan.remote]);
    const files = Object.fromEntries(
      git(plan.destination, ["ls-files", "-z"])
        .split("\0")
        .filter(Boolean)
        .map((path) => [path, fileHash(join(plan.destination, path))])
        .filter(([, hash]) => hash !== null),
    );
    const origin = {
      schemaVersion: 1,
      id: randomUUID(),
      name: plan.name,
      createdAt: new Date().toISOString(),
      template: {
        id: plan.templateId,
        revision: plan.revision,
        repository: remoteUrl(plan.source),
      },
      parameters: { org: plan.org, scope: plan.scope },
      setup: plan.install ? "installed" : "pending",
      files,
    };
    writeJson(join(plan.destination, ORIGIN_FILE), origin);
    commitProject(
      plan.destination,
      `chore: initialize ${plan.name} from template ${plan.revision.slice(0, 12)}`,
      true,
    );
    initialized = true;
    const record = registerProject(plan.source, plan.destination);
    return { ...record, path: realpathSync(plan.destination), setup: origin.setup };
  } catch (error) {
    // A successfully initialized project survives registry failure and can be registered again.
    if (!initialized) rmSync(plan.destination, { recursive: true, force: true });
    throw new Error(
      initialized
        ? `Project created at ${plan.destination}, but registration failed. Run project-register for this path.`
        : `Project creation failed; reserved destination removed: ${plan.destination}`,
      { cause: error },
    );
  }
}
