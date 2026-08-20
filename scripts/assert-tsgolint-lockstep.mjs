import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function stripYamlScalar(raw) {
  const trimmed = raw.replace(/\s+#.*$/, "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function defaultCatalog(workspaceYaml) {
  const lines = workspaceYaml.split(/\r?\n/);
  const entries = new Map();
  let inCatalog = false;
  for (const line of lines) {
    if (!inCatalog) {
      if (/^catalog:\s*(#.*)?$/.test(line)) {
        inCatalog = true;
      }
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const entry = /^  ([^:#\s]+|["'][^"']+["'])\s*:\s*(.*?)\s*$/.exec(line);
    if (entry === null) {
      continue;
    }
    entries.set(entry[1].replaceAll(/['"]/g, ""), stripYamlScalar(entry[2]));
  }
  return entries;
}

function catalogTypescriptRelease(spec) {
  const match = /^(?:[~^]=?|>=?|<=?)?(\d+\.\d+\.\d+)/.exec(spec.trim());
  if (match === null) {
    fail(
      `pnpm-workspace.yaml catalog typescript pin ${JSON.stringify(spec)} does not start with a MAJOR.MINOR.PATCH version`,
    );
  }
  return match[1];
}

// oxlint-tsgolint publishes only `version`. That field encodes the TypeScript
// release it is built against: MAJOR.MINOR.(typescriptPatch * 1000 + tsgolintPatch).
// 7.0.2001 → TypeScript 7.0.2, tsgolint patch 1. A patch below 1000 cannot hold
// both numbers, so refuse to guess.
function typescriptReleaseFromTsgolint(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    fail(
      `oxlint-tsgolint version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH; cannot map it to a TypeScript release`,
    );
  }
  const patch = Number(match[3]);
  if (!Number.isInteger(patch) || patch < 1000) {
    fail(
      `oxlint-tsgolint ${version} patch ${String(patch)} is below 1000. ` +
        "The published encoding is typescriptPatch * 1000 + tsgolintPatch " +
        "(7.0.2001 → TypeScript 7.0.2). Cannot map this version with confidence.",
    );
  }
  return `${match[1]}.${match[2]}.${String(Math.floor(patch / 1000))}`;
}

const manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
const tsgolint =
  manifest.devDependencies?.["oxlint-tsgolint"] ?? manifest.dependencies?.["oxlint-tsgolint"];
if (typeof tsgolint !== "string") {
  fail("oxlint-tsgolint is not declared in the root package.json");
}
if (tsgolint === "catalog:" || tsgolint.startsWith("catalog:")) {
  fail("oxlint-tsgolint must be an exact version pin, not a catalog reference");
}

const encodedTypescript = typescriptReleaseFromTsgolint(tsgolint);

const catalog = defaultCatalog(readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8"));
if (catalog.size === 0) {
  fail("pnpm-workspace.yaml has no default catalog entries");
}
const typescriptSpec = catalog.get("typescript");
if (typeof typescriptSpec !== "string") {
  fail("pnpm-workspace.yaml default catalog has no typescript pin");
}
const catalogTypescript = catalogTypescriptRelease(typescriptSpec);

if (encodedTypescript !== catalogTypescript) {
  fail(
    `oxlint-tsgolint@${tsgolint} encodes TypeScript ${encodedTypescript}, ` +
      `but the catalog pin is typescript: ${JSON.stringify(typescriptSpec)} (${catalogTypescript})`,
  );
}
