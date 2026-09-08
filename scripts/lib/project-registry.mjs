import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

import { digest, git, projectFile, writeJson } from "./project-files.mjs";

export const ORIGIN_FILE = ".template-origin.json";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function templateConfig(root) {
  const value = JSON.parse(readFileSync(join(root, ".template/config.json"), "utf8"));
  if (value.schemaVersion !== 1 || !UUID.test(value.id))
    throw new Error("Invalid template identity");
  return value;
}

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const HASH = /^[a-f0-9]{64}$/;
const text = (value) => typeof value === "string" && value.length > 0;

export function originFingerprint(origin) {
  return digest(JSON.stringify(origin));
}

export function readOrigin(root) {
  const value = JSON.parse(readFileSync(join(root, ORIGIN_FILE), "utf8"));
  if (
    value.schemaVersion !== 1 ||
    !UUID.test(value.id) ||
    !UUID.test(value.template?.id) ||
    !SHA.test(value.template?.revision) ||
    !text(value.name) ||
    !text(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.files !== "object" ||
    !value.files ||
    Array.isArray(value.files) ||
    Object.keys(value.files).length === 0
  ) {
    throw new Error(`Invalid project origin at ${root}`);
  }
  for (const [path, hash] of Object.entries(value.files)) {
    projectFile(root, path);
    if (!HASH.test(hash)) throw new Error(`Invalid inherited file hash: ${path}`);
  }
  return value;
}

export function remoteUrl(root) {
  let remote;
  try {
    remote = git(root, ["remote", "get-url", "origin"]);
  } catch {
    return null;
  }
  if (/^[^/@:]+@[^/:]+:.+/.test(remote)) return remote;
  try {
    const url = new URL(remote);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
    if (url.protocol !== "ssh:") url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** One file per project avoids a shared registry array that concurrent creators could overwrite. */
export function registerProject(source, checkout) {
  const root = realpathSync(checkout);
  if (realpathSync(git(root, ["rev-parse", "--show-toplevel"])) !== root)
    throw new Error("Checkout must be a Git repository root");
  const origin = readOrigin(root);
  if (origin.template.id !== templateConfig(source).id)
    throw new Error("Project belongs to another template");
  const directory = join(source, ".template/projects");
  const local = join(source, ".template/local");
  mkdirSync(directory, { recursive: true });
  mkdirSync(local, { recursive: true });
  const fingerprint = originFingerprint(origin);
  const existing = projectRecords(source).find((entry) => entry.id === origin.id);
  if (existing && existing.originFingerprint !== fingerprint)
    throw new Error("Registered project origin is immutable; restore its original provenance");
  const record = {
    schemaVersion: 1,
    id: origin.id,
    name: origin.name,
    createdAt: origin.createdAt,
    templateRevision: origin.template.revision,
    originFingerprint: fingerprint,
    repository: remoteUrl(root),
  };
  for (const [path, value] of Object.entries({
    [join(directory, `${origin.id}.json`)]: record,
    [join(local, `${origin.id}.json`)]: { path: root },
  })) {
    const temp = `${path}.${process.pid}.tmp`;
    writeJson(temp, value);
    renameSync(temp, path);
  }
  return record;
}

export function projectRecords(source) {
  const directory = join(source, ".template/projects");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => {
      const record = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (
        record.schemaVersion !== 1 ||
        !UUID.test(record.id) ||
        name !== `${record.id}.json` ||
        !text(record.name) ||
        !text(record.createdAt) ||
        !SHA.test(record.templateRevision) ||
        !HASH.test(record.originFingerprint) ||
        !(record.repository === null || text(record.repository))
      ) {
        throw new Error(`Invalid project registry record: ${name}`);
      }
      const local = join(source, ".template/local", name);
      const path = existsSync(local) ? JSON.parse(readFileSync(local, "utf8")).path : null;
      if (path !== null && (!text(path) || !isAbsolute(path)))
        throw new Error(`Invalid local checkout path: ${name}`);
      return Object.assign(record, { path });
    });
}
