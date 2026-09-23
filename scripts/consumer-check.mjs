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

if (existsSync(".template-origin.json")) {
  process.stdout.write(
    "Consumer workspace: creation acceptance belongs to the template producer.\n",
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

const readManifest = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * The real root of the package that Node resolves for `name` from `directory`. A child process
 * resolves it, because this process caches resolutions and would miss a reinstall.
 */
function resolvedPackage(directory, name) {
  const entry = execFileSync(
    process.execPath,
    ["-p", "require('node:fs').realpathSync(require.resolve(process.argv[1]))", name],
    { cwd: directory, encoding: "utf8" },
  ).trim();
  let root = dirname(entry);
  while (!existsSync(join(root, "package.json")) || readManifest(root).name !== name) {
    assert.notEqual(dirname(root), root, `${name} has no package root`);
    root = dirname(root);
  }
  return { root, manifest: readManifest(root) };
}

/**
 * A consumer on the lowest versions db's peer ranges admit must share one drizzle-orm copy with db,
 * typecheck, and load db under native Node ESM. An exact dependency once nested a second Drizzle
 * copy that web:typecheck rejected, and pg before 8.15.0 has no named ESM export for `Pool`.
 */
function checkDbPeerFloors(manifestPath, manifest) {
  const web = join(packed, "apps/web");
  // Creation renamed the scope, so take the package name from the generated project.
  const name = readManifest(join(generated, "packages/db")).name;
  // Every peer db declares takes part, so a peer added later is exercised without editing this.
  const peers = Object.entries(resolvedPackage(web, name).manifest.peerDependencies ?? {});
  assert.ok(peers.length > 0, "db must declare peer dependencies");
  const floors = Object.fromEntries(
    peers.map(([peer, range]) => {
      const floor = /^\^(\d+\.\d+\.\d+)$/.exec(range)?.[1];
      assert.ok(floor, `db must declare a caret ${peer} peer, found ${range}`);
      return [peer, floor];
    }),
  );
  // A floor may equal the pin, but if every floor does, this step only repeats the pinned run.
  assert.ok(
    Object.entries(floors).some(
      ([peer, floor]) => floor !== resolvedPackage(web, peer).manifest.version,
    ),
    "at least one db peer floor must differ from the consumer pin",
  );
  Object.assign(manifest.dependencies, floors);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run(packed, "pnpm", ["install"]);
  for (const [peer, floor] of Object.entries(floors)) {
    const application = resolvedPackage(web, peer);
    // Resolve db again: pnpm names its store directory after the peer versions it resolved.
    const database = resolvedPackage(resolvedPackage(web, name).root, peer);
    assert.equal(
      database.root,
      application.root,
      `db and the application resolved different ${peer} copies`,
    );
    const { version } = application.manifest;
    assert.equal(
      version,
      floor,
      `the application installed ${peer} ${version}, not the floor ${floor}`,
    );
  }
  // The built server bundles db, so only a direct import exercises Node's own module loading.
  run(web, process.execPath, ["--input-type=module", "-e", "await import(process.argv[1])", name]);
  run(packed, "moon", ["run", "web:typecheck", "--force"]);
  const installed = Object.entries(floors).map(([peer, floor]) => `${peer} ${floor}`);
  process.stdout.write(`consumer-check: db loads and typechecks on ${installed.join(", ")}.\n`);
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
  const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
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
    await Promise.all(
      ["/verify-email", "/session-error"].map(async (path) => {
        const page = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
        assert.equal(page.status, 200, `grouped page ${path} must retain its URL`);
      }),
    );
    const callback = await fetch(`${origin}/callback?code=invalid&state=forged`, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    assert.equal(callback.status, 400, "grouped callback must reach state validation");
    await Promise.all(
      ["/api/auth/email/start", "/api/auth/email/verify"].map(async (path) => {
        const refused = await fetch(`${origin}${path}`, {
          signal: AbortSignal.timeout(5000),
          method: "POST",
          redirect: "manual",
          headers: { origin },
          body: new URLSearchParams(),
        });
        assert.equal(refused.status, 400, `nested endpoint ${path} must reach input validation`);
      }),
    );
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
  run(seed, "git", ["remote", "add", "origin", seed]);
  createProject({
    source: seed,
    name: "consumer-project",
    destination: generated,
    org: "consumer-org",
    scope: "consumer-scope",
  });
  rmSync(join(generated, "services/ping"), { recursive: true, force: true });
  // Unique utilities prove each source registration independently of the primitives' own scan.
  for (const [file, before, after] of [
    ["apps/web/src/routes/__root.tsx", "<html ", '<html className="z-[29]" '],
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
  run(generated, "moon", ["run", "web:build", "web:typecheck", "web:test", "root:project-refs"]);
  run(generated, "moon", ["run", "root:format"]);
  rejectViolation(
    generated,
    "apps/web/src/gate-probe.ts",
    'export const probe: number = "wrong";\n',
    "web:typecheck",
    /not assignable/,
  );
  rejectViolation(
    generated,
    "apps/web/tests/gate-probe.test.ts",
    'import { expect, it } from "vitest";\nit("gate proof", () => expect(true).toBe(false));\n',
    "web:test",
    /expected true to be false/,
  );
  rejectViolation(
    generated,
    "apps/web/src/gate-probe.ts",
    'Promise.resolve("unhandled");\n',
    "root:lint",
    /no-floating-promises/,
  );
  rejectViolation(
    generated,
    "apps/web/src/gate-probe.ts",
    "export const probe={a:1,b:2}\n",
    "root:format-check",
    /gate-probe/,
  );
  run(generated, "moon", ["run", "web:typecheck", "web:test", "root:lint", "root:format-check"]);
  const viewsSources = join(generated, "packages/views/src/sources.css");
  const registeredSources = readFileSync(viewsSources, "utf8");
  try {
    writeFileSync(viewsSources, "");
    run(generated, "moon", ["run", "web:build"]);
    await assert.rejects(exercise(generated), /published views must register/);
    process.stdout.write("consumer-check: missing CSS source registration was rejected.\n");
  } finally {
    writeFileSync(viewsSources, registeredSources);
  }
  run(generated, "moon", ["run", "web:build"]);
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
  // Installed libraries no longer have workspace projects for explicit Moon dependency edges.
  writeFileSync(
    join(packed, "apps/web/moon.yml"),
    'language: "typescript"\nlayer: "application"\ntags: ["web-app"]\n',
  );
  const manifestPath = join(packed, "apps/web/package.json");
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
  run(packed, "moon", ["run", "web:build", "web:typecheck", "web:test"]);
  await exercise(packed);
  checkDbPeerFloors(manifestPath, manifest);
  process.stdout.write("consumer-check: generated and packed consumers passed.\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
