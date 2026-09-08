import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { commitProject, git, projectCommand, within, writeJson } from "./project-files.mjs";
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
  if (existsSync(join(root, ORIGIN_FILE)))
    throw new Error("Create projects from the upstream template checkout");
  if (git(root, ["rev-parse", "--is-shallow-repository"]) === "true")
    throw new Error("Fetch the full template history before creating a project");
  const upstream = remoteUrl(root);
  if (!upstream) throw new Error("Template checkout must have an origin remote");
  remote ??= `git@github.com:${org}/${name}.git`;
  if (!remote || remote.startsWith("-") || remote === upstream)
    throw new Error("Project origin must be distinct from the template upstream");
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
    upstream,
    install,
    templateId: config.id,
  };
}

/** Fetch the selected commit and its ancestors into an independent repository. */
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
    git(plan.destination, ["init", "--initial-branch=main"]);
    git(plan.destination, ["fetch", "--no-tags", plan.source, plan.revision]);
    git(plan.destination, ["checkout", "-B", "main", "FETCH_HEAD"]);
    if (templateConfig(plan.destination).id !== plan.templateId)
      throw new Error("Selected revision belongs to another template identity");
    git(plan.destination, ["remote", "add", "origin", plan.remote]);
    git(plan.destination, ["remote", "add", "upstream", plan.upstream]);
    git(plan.destination, ["config", "branch.main.remote", "origin"]);
    git(plan.destination, ["config", "branch.main.merge", "refs/heads/main"]);
    git(plan.destination, ["config", "remote.pushDefault", "origin"]);
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
    const origin = {
      schemaVersion: 1,
      id: randomUUID(),
      name: plan.name,
      createdAt: new Date().toISOString(),
      template: {
        id: plan.templateId,
        revision: plan.revision,
        repository: plan.upstream,
      },
      parameters: { org: plan.org, scope: plan.scope },
      setup: plan.install ? "installed" : "pending",
    };
    writeJson(join(plan.destination, ORIGIN_FILE), origin);
    commitProject(
      plan.destination,
      `chore: initialize ${plan.name} from template ${plan.revision.slice(0, 12)}`,
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
