import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";

import { createProject } from "./lib/create-project.mjs";
import { initializeProject, projectEnvironment, projectCommand } from "./lib/project-files.mjs";
import { pruneReferences } from "./lib/typescript-references.mjs";

if (!existsSync(".moon/template-reference.json")) {
  process.stdout.write(
    "Consumer workspace: generator acceptance belongs to the template producer.\n",
  );
  process.exit(0);
}

const source = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "baseline-consumer-"));
const seed = join(scratch, "seed");
const generated = join(scratch, "generated");
const packed = join(scratch, "packed");
const tarballs = join(scratch, "tarballs");
// A child Moon must discover its own workspace and toolchain rather than inherit its parent's paths.
process.env.GIT_AUTHOR_NAME = "Baseline verification";
process.env.GIT_AUTHOR_EMAIL = "baseline@example.invalid";
process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;
const env = projectEnvironment();

function run(cwd, command, args) {
  process.stdout.write(`consumer-check: ${command} ${args.join(" ")}\n`);
  return projectCommand(cwd, command, args);
}

function rejectViolation(root, file, content, target, failure) {
  const path = join(root, file);
  writeFileSync(path, content);
  try {
    const result = spawnSync("moon", ["run", target, "--force"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `${target} accepted a deliberate violation`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, failure);
    const line = output.split("\n").find((entry) => failure.test(entry));
    process.stdout.write(
      `consumer-check: negative proof ${target}, exit ${result.status}: ${line}\n`,
    );
  } finally {
    rmSync(path, { force: true });
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function readyResponse(origin, app, attempts) {
  if (app.exitCode !== null) throw new Error(`Consumer server exited ${app.exitCode}`);
  try {
    return await fetch(`${origin}/theme`, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    if (attempts === 0) throw error;
    await setTimeout(100);
    return await readyResponse(origin, app, attempts - 1);
  }
}

async function exercise(root) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ["apps/console/.output/server/index.mjs"], {
    cwd: root,
    env: {
      ...env,
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
      WORKOS_CLIENT_ID: "client_consumer",
      WORKOS_API_KEY: "test-key",
      WORKOS_REDIRECT_URI: `${origin}/callback`,
      WORKOS_COOKIE_PASSWORD: "consumer-test-password-with-at-least-32-characters",
    },
    stdio: "inherit",
  });
  const stopped = new Promise((resolve) => app.once("exit", resolve));
  try {
    const response = await readyResponse(origin, app, 100);
    assert.ok(response?.ok, "built consumer must serve the theme page");
    const anonymous = await fetch(`${origin}/app`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(anonymous.status, 307, "a real protected request without a cookie must redirect");
    const logout = await fetch(`${origin}/api/auth/signout`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(logout.status, 405, "GET must not sign a person out");
    const html = await response.text();
    assert.match(html, /Theme lab/);
    const cssPath = html.match(/href="([^"]+\.css)"/)?.[1];
    assert.ok(cssPath, "built page must link a stylesheet");
    const css = await (
      await fetch(new URL(cssPath, origin), { signal: AbortSignal.timeout(5000) })
    ).text();
    assert.match(css, /--background/);
    assert.match(css, /\.bg-primary/, "published primitives must have generated utilities");
    assert.match(css, /z-index:\s*23/, "published views must register their unique utility");
    assert.match(css, /z-index:\s*29/, "consumer app must register its unique utility");
    const changed = await fetch(`${origin}/api/theme`, {
      signal: AbortSignal.timeout(5000),
      method: "POST",
      redirect: "manual",
      headers: { origin },
      body: new URLSearchParams({ mode: "dark", theme: "canvas" }),
    });
    assert.equal(changed.status, 303);
    const cookie = changed.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const themed = await (
      await fetch(`${origin}/theme`, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
    ).text();
    assert.match(themed, /data-mode="dark"/);
    assert.match(themed, /data-theme="canvas"/);
    process.stdout.write(
      `consumer-check: built HTML, CSS and theme cookie round trip passed in ${root}\n`,
    );
  } finally {
    app.kill("SIGTERM");
    const deadline = globalThis.setTimeout(() => app.kill("SIGKILL"), 5000);
    try {
      await stopped;
    } finally {
      globalThis.clearTimeout(deadline);
    }
  }
}

try {
  mkdirSync(seed);
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: source, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    if (!existsSync(join(source, file))) continue;
    mkdirSync(dirname(join(seed, file)), { recursive: true });
    cpSync(join(source, file), join(seed, file));
  }
  initializeProject(seed, "test: snapshot template for consumer acceptance");
  createProject({
    source: seed,
    name: "consumer-project",
    destination: generated,
    org: "consumer-org",
    scope: "consumer-scope",
  });
  run(generated, "moon", ["generate", "application", "--", "--name", "console", "--port", "5281"]);
  for (const path of ["apps/web", "packages/collections", "services/ping"])
    rmSync(join(generated, path), { recursive: true, force: true });
  // Unique utilities prove each source registration independently of the primitives' own scan.
  for (const [file, before, after] of [
    ["apps/console/src/routes/__root.tsx", "<html ", '<html className="z-[29]" '],
    [
      "packages/views/src/theme-lab/theme-lab.tsx",
      'data-slot="swatch-grid"',
      'data-slot="swatch-grid" className="z-[23]"',
    ],
  ]) {
    const path = join(generated, file);
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes(before), `CSS fixture anchor missing in ${file}`);
    writeFileSync(path, content.replace(before, after));
  }
  pruneReferences(generated);
  run(generated, "pnpm", ["install"]);
  run(generated, "moon", ["sync"]);
  run(generated, "moon", [
    "run",
    "console:build",
    "console:typecheck",
    "console:test",
    "root:template-check",
    "root:project-refs",
  ]);
  run(generated, "moon", ["run", "root:format"]);
  rejectViolation(
    generated,
    "apps/console/src/gate-probe.ts",
    'export const probe: number = "wrong";\n',
    "console:typecheck",
    /not assignable/,
  );
  rejectViolation(
    generated,
    "apps/console/tests/gate-probe.test.ts",
    'import { expect, it } from "vitest";\nit("gate proof", () => expect(true).toBe(false));\n',
    "console:test",
    /expected true to be false/,
  );
  rejectViolation(
    generated,
    "apps/console/src/gate-probe.ts",
    'Promise.resolve("unhandled");\n',
    "root:lint",
    /no-floating-promises/,
  );
  rejectViolation(
    generated,
    "apps/console/src/gate-probe.ts",
    "export const probe={a:1,b:2}\n",
    "root:format-check",
    /gate-probe/,
  );
  run(generated, "moon", [
    "run",
    "console:typecheck",
    "console:test",
    "root:lint",
    "root:format-check",
  ]);
  const viewsSources = join(generated, "packages/views/src/sources.css");
  const registeredSources = readFileSync(viewsSources, "utf8");
  try {
    writeFileSync(viewsSources, "");
    run(generated, "moon", ["run", "console:build"]);
    await assert.rejects(exercise(generated), /published views must register/);
    process.stdout.write("consumer-check: missing CSS source registration was rejected.\n");
  } finally {
    writeFileSync(viewsSources, registeredSources);
  }
  run(generated, "moon", ["run", "console:build"]);
  await exercise(generated);

  mkdirSync(tarballs);
  const artifacts = new Map();
  for (const entry of readdirSync(join(generated, "packages"))) {
    const directory = join(generated, "packages", entry);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const artifact = join(tarballs, `${entry}.tgz`);
    run(directory, "pnpm", ["pack", "--out", artifact]);
    artifacts.set(manifest.name, artifact);
  }
  cpSync(generated, packed, {
    recursive: true,
    filter: (path) =>
      !relative(generated, path)
        .split(/[\\/]/)
        .some((part) =>
          ["node_modules", ".git", "packages", "services", ".output", "cache"].includes(part),
        ),
  });
  pruneReferences(packed);
  const manifestPath = join(packed, "apps/console/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[section])) {
      if (artifacts.has(name)) manifest[section][name] = `file:${artifacts.get(name)}`;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const workspacePath = join(packed, "pnpm-workspace.yaml");
  writeFileSync(
    workspacePath,
    `${readFileSync(workspacePath, "utf8")}\n${[...artifacts].map(([name, file]) => `  "${name}": "file:${file}"`).join("\n")}\n`,
  );
  initializeProject(packed, "test: initialize packed consumer");
  run(packed, "pnpm", ["install"]);
  run(packed, "moon", ["sync"]);
  run(packed, "moon", ["run", "console:build", "console:typecheck", "console:test"]);
  await exercise(packed);
  process.stdout.write("consumer-check: generated and packed consumers passed.\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
