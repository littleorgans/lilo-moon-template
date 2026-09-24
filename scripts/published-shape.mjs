import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { basename, dirname, join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { dockerIsAvailable, psqlInput, withPostgres } from "@littleorgans/db-tools";

import {
  CONSUMER_TYPESCRIPT,
  consumerCompilerOptions,
  entriesModule,
  entryPoints,
  typecheckConsumer,
} from "./lib/package-entries.mjs";
import {
  initializeProject,
  projectEnvironment,
  projectCommand,
  writeJson,
} from "./lib/project-files.mjs";
import { readReleaseTarballs } from "./lib/release-tarballs.mjs";
import { pruneReferences } from "./lib/typescript-references.mjs";

const source = process.cwd();
// With a release directory from `node scripts/release.mjs pack`, only the tarball checks run, on
// exactly those files, against this installed workspace. The release gate uses this so the tarballs
// it checks are the ones it publishes. Without one, the whole check runs on a workspace snapshot.
const releaseDirectory = process.argv[2];
const scratch = mkdtempSync(join(tmpdir(), "published-shape-"));
const snapshot = join(scratch, "snapshot");
// The installed workspace whose manifests and third-party versions the tarballs are checked against.
const reference = releaseDirectory === undefined ? snapshot : source;
const packed = join(scratch, "packed");
const tarballs = join(scratch, "tarballs");
// A child Moon must discover its own workspace and toolchain rather than inherit its parent's paths.
process.env.GIT_AUTHOR_NAME = "Baseline verification";
process.env.GIT_AUTHOR_EMAIL = "baseline@example.invalid";
process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;
const env = projectEnvironment();

function run(cwd, command, args) {
  process.stdout.write(`published-shape: ${command} ${args.join(" ")}\n`);
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
  // Take the package name from the manifest, so the scope is not written twice.
  const name = readManifest(join(snapshot, "packages/db")).name;
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
  process.stdout.write(`published-shape: db loads and typechecks on ${installed.join(", ")}.\n`);
}

/** The packed consumer's compiler options come from the installed @littleorgans/tsconfig tarball. */
function checkPackedCompilerOptions() {
  const { root } = resolvedPackage(packed, "@littleorgans/tsconfig");
  assert.ok(
    !root.startsWith(snapshot),
    `@littleorgans/tsconfig resolved to the workspace at ${root}`,
  );
  const { compilerOptions } = JSON.parse(
    execFileSync(
      join(packed, "node_modules/.bin/tsc"),
      ["--project", "apps/web/tsconfig.json", "--showConfig"],
      { cwd: packed, env, encoding: "utf8" },
    ),
  );
  for (const option of ["noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "composite"]) {
    assert.equal(compilerOptions[option], true, `the packed web app lost ${option}`);
  }
  process.stdout.write(`published-shape: compiler options resolve from ${root}\n`);
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
      `published-shape: negative proof ${target}, exit ${result.status}: ${line}\n`,
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
    return await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    if (attempts === 0) throw error;
    await setTimeout(100);
    return await readyResponse(origin, app, attempts - 1);
  }
}

function authEnvironment(origin) {
  return {
    WORKOS_CLIENT_ID: "client_consumer",
    WORKOS_API_KEY: "test-key",
    WORKOS_REDIRECT_URI: `${origin}/callback`,
    WORKOS_COOKIE_PASSWORD: "consumer-test-password-with-at-least-32-characters",
    // Parsed from the installed tarball before the server listens, so a packed loadAuthConfig that
    // refused a well-formed rotation list would fail every assertion below.
    WORKOS_COOKIE_PASSWORD_PREVIOUS: "consumer-previous-password-with-at-least-32-chars",
  };
}

/**
 * A built server whose cookie password would refuse every sign-in must fail the deploy, not the
 * first request: it exits before it listens, naming the variable and not the value.
 */
async function refusesBadConfiguration(root) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const cases = [
    [
      "WORKOS_COOKIE_PASSWORD",
      "far-too-short",
      /WORKOS_COOKIE_PASSWORD must be at least 32 characters/,
    ],
    [
      "WORKOS_REDIRECT_URI",
      "accidentally-pasted-secret",
      /WORKOS_REDIRECT_URI must be an absolute URL/,
    ],
  ];
  for (const [name, value, message] of cases) {
    const app = spawnSync(process.execPath, ["apps/web/.output/server/index.mjs"], {
      cwd: root,
      env: {
        ...env,
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: String(port),
        ...authEnvironment(origin),
        [name]: value,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    const output = `${app.stdout}${app.stderr}`;
    assert.equal(app.error, undefined, "the invalid server must exit, not time out");
    assert.ok(
      Number.isInteger(app.status) && app.status !== 0,
      "the invalid server must exit nonzero",
    );
    assert.match(output, message);
    assert.doesNotMatch(output, /Listening on/, "the server must refuse before it listens");
    assert.ok(!output.includes(value), "the refusal must not print the invalid value");
    process.stdout.write(
      `published-shape: negative proof, invalid ${name} stopped the built server, exit ${app.status}.\n`,
    );
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
      ...authEnvironment(origin),
    },
    stdio: "inherit",
  });
  const stopped = new Promise((resolve) => app.once("exit", resolve));
  try {
    const response = await readyResponse(origin, app, 100);
    assert.ok(response?.ok, "built consumer must serve the sign-in page");
    // The theme lab is a reference page for the dev server; a production build must not serve it.
    const lab = await fetch(`${origin}/theme`, { signal: AbortSignal.timeout(5000) });
    assert.equal(lab.status, 404, "a production build must not serve the theme lab");
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
    // Every state-changing POST refuses a page on another origin, and a missing Origin alike,
    // before it reads a field or reaches the provider.
    await Promise.all(
      ["/api/auth/email/start", "/api/auth/email/verify", "/api/auth/signout", "/api/theme"]
        .flatMap((path) => [
          { path, headers: { origin: "https://evil.example" } },
          { path, headers: {} },
        ])
        .map(async ({ path, headers }) => {
          const forged = await fetch(`${origin}${path}`, {
            signal: AbortSignal.timeout(5000),
            method: "POST",
            redirect: "manual",
            headers,
            body: new URLSearchParams({ email: "owner@example.com", mode: "dark" }),
          });
          assert.equal(
            forged.status,
            403,
            `${path} must refuse Origin ${headers.origin ?? "(none)"}`,
          );
        }),
    );
    const html = await response.text();
    assert.match(html, /action="\/api\/auth\/email\/start"/);
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
      await fetch(`${origin}/`, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
    ).text();
    assert.match(themed, /data-mode="dark"/);
    assert.match(themed, /data-theme="canvas"/);
    process.stdout.write(
      `published-shape: built HTML, CSS and theme cookie round trip passed in ${root}\n`,
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

const SOURCE_CONDITION = "@littleorgans/source";

// Every publint and attw finding is fixed in the package or suppressed here, one reason per rule.
// publint runs --strict with nothing suppressed. attw's esm-only profile skips the node10 and
// node16-from-CommonJS resolutions: the packages are ESM-only, for Node >= 24.19 and bundlers.
const ATTW_PROFILE = "esm-only";

// Use the versions in the reference workspace's frozen install for third-party dependencies. The
// consumer still installs with npm, outside the workspace, without catalogs or dependency overrides.
function consumerDependencies(packages) {
  const names = new Set(packages.map(({ manifest }) => manifest.name));
  const dependencies = { typescript: CONSUMER_TYPESCRIPT };
  for (const { manifest } of packages) {
    const directory = join(reference, manifest.repository.directory);
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (!names.has(name))
        dependencies[name] = readManifest(join(directory, "node_modules", name)).version;
    }
  }
  for (const name of ["@types/node", "@types/react", "@types/react-dom"]) {
    dependencies[name] = readManifest(join(reference, "apps/web/node_modules", name)).version;
  }
  return dependencies;
}

const capture = (cwd, command, args) => spawnSync(command, args, { cwd, env, encoding: "utf8" });

function succeeded(result, description) {
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, `${description} failed:\n${output}`);
  return output;
}

// No lifecycle scripts, and nothing published in the last day, as this workspace's pnpm allows.
const npmInstall = (root) =>
  capture(root, "npm", [
    "install",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--min-release-age=1",
    "--prefer-offline",
  ]);

/**
 * A tarball as a consumer receives it: its manifest and every concrete entry point `exports`
 * declares, with each wildcard subpath expanded against the files in the tarball. Reading the
 * packed manifest covers a new package or subpath without editing this script.
 */
function inspectTarball(artifact) {
  const root = join(scratch, "unpacked", basename(artifact, ".tgz"));
  mkdirSync(root, { recursive: true });
  execFileSync("tar", ["-xzf", artifact, "-C", root, "--strip-components=1"]);
  const { manifest, entries } = entryPoints(root);
  const workspace = readManifest(join(reference, manifest.repository.directory));
  assert.deepEqual(
    Object.keys(manifest.exports).toSorted(),
    Object.keys(workspace.exports).toSorted(),
    `${manifest.name} publishConfig must preserve every workspace subpath`,
  );
  // publishConfig.exports repeats exports without the workspace source condition, so each packed
  // entry must be its workspace entry minus that condition. Only vite-config's entries redirect src
  // to dist, because Vite and Vitest load them before any build; check both sides explicitly so this
  // exception cannot hide another export's drift.
  for (const [subpath, target] of Object.entries(workspace.exports)) {
    let published =
      typeof target === "string"
        ? target
        : Object.fromEntries(Object.entries(target).filter(([key]) => key !== SOURCE_CONDITION));
    const redirectsSource = workspace.name === "@littleorgans/vite-config";
    if (redirectsSource) {
      const module = subpath === "." ? "index" : subpath.slice(2);
      assert.deepEqual(
        target,
        { types: `./src/${module}.ts`, default: `./src/${module}.ts` },
        `${manifest.name} exports["${subpath}"] must point at its workspace source entry`,
      );
      published = {
        types: `./dist/${module}.d.ts`,
        import: `./dist/${module}.js`,
        default: `./dist/${module}.js`,
      };
    }
    assert.deepEqual(
      manifest.exports[subpath],
      published,
      redirectsSource
        ? `${manifest.name} publishConfig.exports["${subpath}"] must point at its built entry`
        : `${manifest.name} publishConfig.exports["${subpath}"] must equal exports["${subpath}"] without ${SOURCE_CONDITION}`,
    );
  }
  return { artifact, manifest, entries };
}

function lintTarball({ artifact, manifest, entries }) {
  succeeded(
    capture(dirname(artifact), join(source, "node_modules/.bin/publint"), [
      "run",
      artifact,
      "--strict",
    ]),
    `publint ${manifest.name}`,
  );
  const typed = entries.filter((entry) => entry.types).map((entry) => entry.subpath);
  // Asset subpaths are left out: attw checks module entry points, and the consumer resolves assets.
  if (typed.length > 0) {
    succeeded(
      capture(dirname(artifact), join(source, "node_modules/.bin/attw"), [
        artifact,
        "--profile",
        ATTW_PROFILE,
        "--format",
        "ascii",
        "--no-color",
        "--entrypoints",
        ...typed,
      ]),
      `attw ${manifest.name}`,
    );
  }
  process.stdout.write(
    `published-shape: ${manifest.name}, entry points ${entries.length}: publint and attw clean\n`,
  );
}

/** Every directory under `root`'s node_modules trees that holds a copy of `name`. */
function installedCopies(root, name) {
  const modules = join(root, "node_modules");
  if (!existsSync(modules)) return [];
  const own = existsSync(join(modules, name, "package.json")) ? [join(modules, name)] : [];
  const nested = readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) =>
      entry.name.startsWith("@")
        ? readdirSync(join(modules, entry.name)).map((child) => join(modules, entry.name, child))
        : [join(modules, entry.name)],
    )
    .flatMap((directory) => installedCopies(directory, name));
  return [...own, ...nested];
}

// A library and service consumer outside any workspace. npm installs every tarball and pins direct
// third-party dependencies to the reference install, without a catalog. It imports and typechecks
// every entry point, then runs a service on packed auth, auth-http and db against Postgres, and the
// packed rls-verify bin against the result.
async function exerciseConsumer(packages) {
  const root = join(scratch, "consumer");
  mkdirSync(root);
  const names = new Set(packages.map(({ manifest }) => manifest.name));
  const scopedName = (suffix) => {
    const name = [...names].find((candidate) => candidate.endsWith(`/${suffix}`));
    assert.ok(name, `${suffix} must be packed`);
    return name;
  };
  writeJson(join(root, "package.json"), {
    name: "published-shape-consumer",
    private: true,
    type: "module",
    dependencies: {
      ...Object.fromEntries(
        packages.map(({ manifest, artifact }) => [manifest.name, `file:${artifact}`]),
      ),
      ...consumerDependencies(packages),
    },
  });
  writeJson(join(root, "tsconfig.json"), {
    compilerOptions: consumerCompilerOptions,
    include: ["*.ts"],
  });
  const {
    modules,
    assets,
    source: entriesSource,
  } = entriesModule(packages.flatMap((pkg) => pkg.entries));
  writeFileSync(join(root, "entries.ts"), entriesSource);
  const scope = scopedName("auth").split("/")[0];
  const httpName = scopedName("auth-http");
  const dbName = scopedName("db");
  writeFileSync(
    join(root, "service.ts"),
    `import assert from "node:assert/strict";

import { createVerifier } from "${scope}/auth";
import { loadServiceConfig } from "${httpName}";
import { requireAuth } from "${httpName}/hono";
import type { AuthEnv } from "${httpName}/hono";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const issuer = "https://issuer.example";
const { publicKey, privateKey } = await generateKeyPair("ES256");
const verify = createVerifier({ issuer, jwks: { keys: [await exportJWK(publicKey)] } });
const app = new Hono<AuthEnv>().use(requireAuth({ verify })).get("/me", (c) => c.json(c.var.principal));

const anonymous = await app.request("/me");
assert.equal(anonymous.status, 401);
assert.equal(anonymous.headers.get("www-authenticate"), "Bearer");
const token = await new SignJWT({ sub: "user_consumer" })
  .setProtectedHeader({ alg: "ES256" })
  .setIssuer(issuer)
  .setExpirationTime("5m")
  .sign(privateKey);
const signedIn = await app.request("/me", { headers: { authorization: \`Bearer \${token}\` } });
assert.equal(signedIn.status, 200);
assert.deepEqual(await signedIn.json(), {
  userId: "user_consumer",
  orgId: null,
  roles: [],
  permissions: [],
  entitlements: [],
});
assert.throws(() => loadServiceConfig({}), /PORT is missing/);
`,
  );
  writeFileSync(
    join(root, "database.ts"),
    `import assert from "node:assert/strict";

import type { Principal } from "${scope}/auth";
import { createDatabase } from "${dbName}";
import { sql } from "drizzle-orm";
import { Client } from "pg";

const { GRANTED_URL, UNGRANTED_URL } = process.env;
assert.ok(GRANTED_URL && UNGRANTED_URL, "the login role URLs are required");
const principal = (orgId: string): Principal => ({
  userId: \`user_\${orgId}\`,
  orgId,
  roles: [],
  permissions: [],
  entitlements: [],
});
const orgs = ["org_a", "org_b"];

const granted = createDatabase({ connectionString: GRANTED_URL });
try {
  for (const org of orgs) {
    await granted.withPrincipal(principal(org), (tx) =>
      tx.execute(sql\`INSERT INTO accounts (workos_org_id) VALUES (\${org})\`),
    );
    await granted.withPrincipal(principal(org), (tx) =>
      tx.execute(sql\`INSERT INTO profiles (workos_user_id) VALUES (\${principal(org).userId})\`),
    );
  }
  for (const org of orgs) {
    const seen = await granted.withPrincipal(principal(org), async (tx) =>
      (await tx.execute(sql\`SELECT workos_org_id FROM accounts\`)).rows,
    );
    assert.deepEqual(seen, [{ workos_org_id: org }], \`\${org} must see only its own account\`);
    const profiles = await granted.withPrincipal(principal(org), async (tx) =>
      (await tx.execute(sql\`SELECT workos_user_id FROM profiles\`)).rows,
    );
    assert.deepEqual(profiles, [{ workos_user_id: principal(org).userId }]);
  }
} finally {
  await granted.close();
}

// Outside a scoped transaction the login role has no table privileges of its own.
const direct = new Client({ connectionString: GRANTED_URL });
await direct.connect();
try {
  const membership = await direct.query(\`SELECT admin_option, inherit_option, set_option
    FROM pg_auth_members WHERE member = current_user::regrole AND roleid = 'authenticated'::regrole\`);
  assert.deepEqual(membership.rows, [{ admin_option: false, inherit_option: false, set_option: true }]);
  const tables = await direct.query(\`SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid IN ('public.accounts'::regclass, 'public.profiles'::regclass)
    ORDER BY relname\`);
  assert.deepEqual(tables.rows, ["accounts", "profiles"].map(relname =>
    ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
  await assert.rejects(direct.query("SELECT workos_org_id FROM accounts"), { code: "42501" });
} finally {
  await direct.end();
}

const ungranted = createDatabase({ connectionString: UNGRANTED_URL });
try {
  await assert.rejects(
    ungranted.withPrincipal(principal("org_a"), (tx) => tx.execute(sql\`SELECT 1\`)),
    { code: "42501", message: 'permission denied to set role "authenticated"' },
  );
} finally {
  await ungranted.close();
}
`,
  );
  succeeded(npmInstall(root), `npm install in ${root}`);
  for (const { manifest } of packages) {
    const copies = installedCopies(root, manifest.name);
    assert.equal(copies.length, 1, `npm installed ${manifest.name} ${copies.length} times`);
    // A peer or a sibling package nested under a package is a second copy the application never sees.
    const shared = [
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.dependencies ?? {}).filter((name) => names.has(name)),
    ];
    for (const name of shared) {
      const nested = installedCopies(copies[0], name);
      assert.deepEqual(nested, [], `${manifest.name} has its own copy of ${name}`);
    }
  }
  const db = packages.find(({ manifest }) => manifest.name === dbName);
  for (const peer of Object.keys(db.manifest.peerDependencies)) {
    assert.equal(
      installedCopies(root, peer).length,
      1,
      `${dbName} and the consumer must share one ${peer}`,
    );
  }
  process.stdout.write(`published-shape: ${typecheckConsumer(root, env)}\n`);
  run(root, process.execPath, ["entries.ts"]);
  process.stdout.write(
    `published-shape: ${modules.length} module and ${assets.length} file entry points resolve in ${root}\n`,
  );
  run(root, process.execPath, ["service.ts"]);
  process.stdout.write(`published-shape: packed auth-http served 401 and 200 in ${root}\n`);
  checkBins(root, packages);
  await exerciseServiceDatabase(root, dbName);
}

// Every packed bin starts from the consumer's install, where only dist and the declared dependencies
// exist. --help loads the whole command module without needing a database.
function checkBins(root, packages) {
  for (const { manifest } of packages) {
    assert.notEqual(typeof manifest.bin, "string", `${manifest.name} must name its bins`);
    for (const bin of Object.keys(manifest.bin ?? {})) {
      const output = succeeded(
        capture(root, join(root, "node_modules/.bin", bin), ["--help"]),
        `${bin} --help`,
      );
      assert.match(output, new RegExp(`^Usage: ${bin} `), `${bin} --help printed no usage`);
      process.stdout.write(`published-shape: packed ${bin} --help\n`);
    }
  }
}

// The packed db-tools generating the typed schema from the installed db's migrations: Atlas from
// PATH and drizzle-kit resolved as db-tools's peer from the consumer's node_modules. --root puts the
// database in this checkout's container rather than a new one for the scratch directory.
function generateConsumerSchema(root, installed) {
  // A project pins Atlas in .prototools (the adoption guides copy this one), and a proto shim on
  // PATH cannot choose a version without it.
  cpSync(join(source, ".prototools"), join(root, ".prototools"));
  const out = join(root, "db/drizzle/_generated");
  succeeded(
    capture(root, join(root, "node_modules/.bin/db-tools"), [
      "drizzle-generate",
      "--migrations",
      join(installed, "migrations"),
      "--out",
      out,
      "--root",
      source,
    ]),
    "db-tools drizzle-generate",
  );
  const schema = readFileSync(join(out, "schema.ts"), "utf8");
  for (const table of ["accounts", "profiles"]) {
    assert.ok(schema.includes(`pgTable("${table}"`), `the generated schema has no ${table} table`);
  }
  process.stdout.write(`published-shape: packed db-tools generated ${relative(root, out)}\n`);
}

/** The newest release line below `version`: one minor back on 0.x, where minors break. */
function lineBelow(version) {
  const [major, minor] = version.split(".").map(Number);
  if (major > 0) return `^${major - 1}.0.0`;
  assert.ok(minor > 0, `no release line below ${version}`);
  return `~0.${minor - 1}.0`;
}

/**
 * The skew a consumer meets first. On a drizzle-orm line older than db's peer range, npm must
 * refuse the install and name both packages; it once nested a second copy under db instead, and
 * the consumer found out from TS2345 on `tx.execute`. On the range's floor, it must share db's
 * copy, and that call must typecheck.
 */
function checkDrizzleSkew(packages) {
  const db = packages.find(({ manifest }) => manifest.name.endsWith("/db"));
  assert.ok(db, "db must be packed");
  const { name } = db.manifest;
  assert.ok(
    db.manifest.peerDependencies?.["@types/pg"] &&
      !db.manifest.peerDependenciesMeta?.["@types/pg"]?.optional,
    `${name} must require @types/pg so consumers receive typed query results`,
  );
  const internal = packages.filter(
    ({ manifest }) => manifest.name in (db.manifest.dependencies ?? {}),
  );
  const consumer = (directory, drizzle) => {
    const root = join(scratch, directory);
    mkdirSync(root);
    writeJson(join(root, "package.json"), {
      name: `published-shape-${directory}`,
      private: true,
      type: "module",
      dependencies: {
        ...Object.fromEntries(
          [db, ...internal].map(({ manifest, artifact }) => [manifest.name, `file:${artifact}`]),
        ),
        "drizzle-orm": drizzle,
        typescript: CONSUMER_TYPESCRIPT,
        "@types/node": readManifest(join(reference, "node_modules/@types/node")).version,
        pg: readManifest(join(reference, "packages/db/node_modules/pg")).version,
        "@types/pg": readManifest(join(reference, "packages/db/node_modules/@types/pg")).version,
      },
    });
    return root;
  };

  // Taken from this workspace's install rather than db's range, so a db that stops declaring the
  // peer is still put through the skew.
  const pinned = readManifest(join(source, "packages/db/node_modules/drizzle-orm")).version;
  const older = lineBelow(pinned);
  const skewed = consumer("skew", older);
  const refused = npmInstall(skewed);
  const output = `${refused.stdout}${refused.stderr}`;
  const nested = installedCopies(join(skewed, "node_modules", name), "drizzle-orm");
  assert.notEqual(
    refused.status,
    0,
    `npm installed drizzle-orm ${older} beside ${name} without a peer error${nested.length > 0 ? `, and nested ${name}'s own copy at ${nested.join(", ")}` : ""}`,
  );
  assert.match(
    output,
    /^npm (?:error|ERR!) code ERESOLVE\b/m,
    `npm refused drizzle-orm ${older} for another reason:\n${output}`,
  );
  const range = db.manifest.peerDependencies?.["drizzle-orm"];
  assert.ok(
    output.includes(`peer drizzle-orm@"${range}" from ${name}@`),
    `npm's refusal must name ${name}'s drizzle-orm peer:\n${output}`,
  );
  process.stdout.write(
    `published-shape: npm refused drizzle-orm ${older} for ${name}: peer drizzle-orm@"${range}"\n`,
  );

  const floor = /^\^(\d+\.\d+\.\d+)$/.exec(range)?.[1];
  assert.ok(floor, `${name} must declare a caret drizzle-orm peer, found ${range}`);
  const aligned = consumer("floor", floor);
  writeFileSync(
    join(aligned, "skew.ts"),
    `import { createDatabase } from "${name}";
import { sql } from "drizzle-orm";

const database = createDatabase({ connectionString: "postgres://localhost/unused" });
const principal = { userId: "user", orgId: null, roles: [], permissions: [], entitlements: [] };
const result = await database.withPrincipal(principal, (tx) => tx.execute(sql\`select 1\`));
// @ts-expect-error A pg QueryResult is not a string; this also rejects an accidental any result.
const wrong: string = result;
void wrong;
`,
  );
  writeJson(join(aligned, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2024",
      lib: ["ES2024"],
      types: ["node"],
      module: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ["skew.ts"],
  });
  succeeded(npmInstall(aligned), `npm install in ${aligned}`);
  const copies = installedCopies(aligned, "drizzle-orm");
  assert.deepEqual(
    copies.map((copy) => readManifest(copy).version),
    [floor],
    `drizzle-orm ${floor} must be the only copy, found ${copies.join(", ")}`,
  );
  process.stdout.write(`published-shape: ${typecheckConsumer(aligned, env)}\n`);
  process.stdout.write(`published-shape: drizzle-orm ${floor} is ${name}'s only copy\n`);
}

// The packed db-tools bin, run the way a consumer runs it: against the database the service already
// set up, as the service's own login role, then against the same database with row level security
// broken twice over, then in a scratch database built from the installed db's migrations.
function verifyServiceRls(root, databaseUrl, loginUrl, password) {
  const rlsVerify = (url, args = []) => {
    process.stdout.write(`published-shape: rls-verify ${args.join(" ")}\n`);
    const result = spawnSync(join(root, "node_modules/.bin/rls-verify"), args, {
      cwd: root,
      env: { ...env, DATABASE_URL: url },
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    process.stdout.write(output);
    assert.ok(!output.includes(password), "rls-verify printed the login role's password");
    return { status: result.status, output };
  };
  assert.equal(rlsVerify(loginUrl).status, 0, "rls-verify must pass on the service's database");
  for (const [broken, restored, failure] of [
    [
      "ALTER TABLE profiles NO FORCE ROW LEVEL SECURITY;",
      "ALTER TABLE profiles FORCE ROW LEVEL SECURITY;",
      /unprotected: public\.profiles \(not forced\)/,
    ],
    [
      "CREATE POLICY consumer_open ON accounts FOR SELECT USING (true);",
      "DROP POLICY consumer_open ON accounts;",
      /rows visible without claims in public\.accounts/,
    ],
  ]) {
    psqlInput(databaseUrl, broken);
    try {
      const { status, output } = rlsVerify(loginUrl);
      assert.equal(status, 1, `rls-verify accepted: ${broken}`);
      assert.match(output, failure);
      process.stdout.write(
        `published-shape: negative proof rls-verify, exit ${status}: ${broken}\n`,
      );
    } finally {
      psqlInput(databaseUrl, restored);
    }
  }
  assert.equal(rlsVerify(databaseUrl, ["--disposable"]).status, 0, "disposable rls-verify failed");
}

// The db README's setup, run from the installed tarball against Postgres 17: the shipped migrations
// in file-name order, then the shipped grant for one fresh login role and not for another. The
// service connects as each, never as the superuser that applied the migrations.
async function exerciseServiceDatabase(root, dbName) {
  if (!process.env.CI && !dockerIsAvailable()) {
    process.stdout.write(
      "published-shape: service database skipped locally: Docker is unavailable.\n",
    );
    return;
  }
  const installed = join(root, "node_modules", dbName);
  const resolveExport = (subpath) =>
    fileURLToPath(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          "process.stdout.write(import.meta.resolve(process.argv[1]))",
          `${dbName}/${subpath}`,
        ],
        { cwd: root, encoding: "utf8" },
      ).trim(),
    );
  await withPostgres("published-shape", async (databaseUrl) => {
    const migrations = join(installed, "migrations");
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .toSorted()) {
      process.stdout.write(`published-shape: psql -f ${relative(root, join(migrations, file))}\n`);
      psqlInput(databaseUrl, readFileSync(resolveExport(`migrations/${file}`)));
    }
    // Roles are cluster-wide, so the pid keeps concurrent runs apart.
    const roles = {
      granted: `consumer-login-${process.pid}`,
      ungranted: `consumer_ungranted_${process.pid}`,
    };
    const password = randomBytes(16).toString("hex");
    const connectAs = (role) => {
      const url = new URL(databaseUrl);
      url.username = role;
      url.password = password;
      return url.href;
    };
    try {
      for (const role of Object.values(roles)) {
        psqlInput(
          databaseUrl,
          `DROP ROLE IF EXISTS :"role"; CREATE ROLE :"role" LOGIN PASSWORD :'password';`,
          { role, password },
        );
      }
      // Prove re-running also repairs an unsafe existing membership from the same grantor.
      psqlInput(
        databaseUrl,
        'GRANT authenticated TO :"role" WITH ADMIN TRUE, INHERIT TRUE, SET FALSE;',
        { role: roles.granted },
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        psqlInput(databaseUrl, readFileSync(resolveExport("grants/login-role.sql")), {
          login_role: roles.granted,
        });
      }
      process.stdout.write(`published-shape: node database.ts as ${roles.granted}\n`);
      execFileSync(process.execPath, ["database.ts"], {
        cwd: root,
        env: {
          ...env,
          GRANTED_URL: connectAs(roles.granted),
          UNGRANTED_URL: connectAs(roles.ungranted),
        },
        stdio: "inherit",
      });
      verifyServiceRls(root, databaseUrl, connectAs(roles.granted), password);
      generateConsumerSchema(root, installed);
    } finally {
      psqlInput(
        databaseUrl,
        `DROP ROLE IF EXISTS :"granted"; DROP ROLE IF EXISTS :"ungranted";`,
        roles,
      );
    }
  });
  process.stdout.write(
    "published-shape: packed db migrations and grant isolated each org; the ungranted role was refused.\n",
  );
}

// The tarballs the release will publish, checked where a consumer meets them: publint and attw,
// then npm consumers that import, typecheck and run them. The packed reference app is not rebuilt:
// it needs the snapshot's CSS fixtures, which these tarballs do not carry.
async function checkReleaseTarballs(directory) {
  const packages = readReleaseTarballs(directory).map(({ file }) => inspectTarball(file));
  for (const pkg of packages) lintTarball(pkg);
  await exerciseConsumer(packages);
  checkDrizzleSkew(packages);
  process.stdout.write(
    `published-shape: the ${packages.length} release tarballs in ${directory} passed the npm and skew consumers.\n`,
  );
}

async function checkSnapshot() {
  mkdirSync(snapshot);
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: source, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    if (!existsSync(join(source, file))) continue;
    mkdirSync(dirname(join(snapshot, file)), { recursive: true });
    cpSync(join(source, file), join(snapshot, file));
  }
  initializeProject(snapshot, "test: snapshot the workspace for consumer acceptance");
  // Unique utilities prove each source registration independently of the primitives' own scan.
  for (const [file, before, after] of [
    ["apps/web/src/routes/__root.tsx", "<html ", '<html className="z-[29]" '],
    [
      "packages/views/src/theme-lab/theme-lab.tsx",
      'data-slot="swatch-grid"',
      'data-slot="swatch-grid" className="z-[23]"',
    ],
  ]) {
    const path = join(snapshot, file);
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes(before), `CSS fixture anchor missing in ${file}`);
    writeFileSync(path, content.replace(before, after));
  }
  pruneReferences(snapshot);
  run(snapshot, "pnpm", ["install", "--frozen-lockfile"]);
  run(snapshot, "moon", ["sync"]);
  run(snapshot, "moon", ["run", "web:build", "web:typecheck", "web:test", "root:project-refs"]);
  run(snapshot, "moon", ["run", "root:format"]);
  rejectViolation(
    snapshot,
    "apps/web/src/gate-probe.ts",
    'export const probe: number = "wrong";\n',
    "web:typecheck",
    /not assignable/,
  );
  rejectViolation(
    snapshot,
    "apps/web/tests/gate-probe.test.ts",
    'import { expect, it } from "vitest";\nit("gate proof", () => expect(true).toBe(false));\n',
    "web:test",
    /expected true to be false/,
  );
  rejectViolation(
    snapshot,
    "apps/web/src/gate-probe.ts",
    'Promise.resolve("unhandled");\n',
    "root:lint",
    /no-floating-promises/,
  );
  rejectViolation(
    snapshot,
    "apps/web/src/gate-probe.ts",
    "export const probe={a:1,b:2}\n",
    "root:format-check",
    /gate-probe/,
  );
  run(snapshot, "moon", ["run", "web:typecheck", "web:test", "root:lint", "root:format-check"]);
  const viewsSources = join(snapshot, "packages/views/src/sources.css");
  const registeredSources = readFileSync(viewsSources, "utf8");
  try {
    writeFileSync(viewsSources, "");
    run(snapshot, "moon", ["run", "web:build"]);
    await assert.rejects(exercise(snapshot), /published views must register/);
    process.stdout.write("published-shape: missing CSS source registration was rejected.\n");
  } finally {
    writeFileSync(viewsSources, registeredSources);
  }
  run(snapshot, "moon", ["run", "web:build"]);
  await refusesBadConfiguration(snapshot);
  await exercise(snapshot);

  mkdirSync(tarballs);
  const artifacts = new Map();
  for (const entry of readdirSync(join(snapshot, "packages"))) {
    const directory = join(snapshot, "packages", entry);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const artifact = join(tarballs, `${entry}.tgz`);
    run(directory, "pnpm", ["pack", "--out", artifact]);
    artifacts.set(manifest.name, artifact);
  }
  const packages = [...artifacts.values()].map((artifact) => inspectTarball(artifact));
  for (const pkg of packages) lintTarball(pkg);
  cpSync(snapshot, packed, {
    recursive: true,
    filter: (path) =>
      !relative(snapshot, path)
        .split(/[\\/]/)
        .some((part) =>
          ["node_modules", ".git", "packages", "services", ".output", "cache"].includes(part),
        ),
  });
  pruneReferences(packed);
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
  // The optional drizzle-kit peer belongs to the consumer that runs generation, not to db-tools.
  const packedManifest = readManifest(packed);
  packedManifest.devDependencies["drizzle-kit"] = resolvedPackage(
    join(reference, "packages/db-tools"),
    "drizzle-kit",
  ).manifest.version;
  writeJson(join(packed, "package.json"), packedManifest);
  initializeProject(packed, "test: initialize packed consumer");
  run(packed, "pnpm", ["install"]);
  checkBins(packed, packages);
  if (process.env.CI || dockerIsAvailable()) {
    generateConsumerSchema(
      packed,
      resolvedPackage(join(packed, "apps/web"), "@littleorgans/db").root,
    );
  }
  run(packed, "moon", ["sync"]);
  // The root's tsconfig.options.json, .oxlintrc.json and vitest.config.ts now resolve the packed
  // config packages, so these tasks prove them as a consumer installs them.
  checkPackedCompilerOptions();
  run(packed, "moon", ["run", "web:build", "web:typecheck", "web:test", "root:lint"]);
  rejectViolation(
    packed,
    "apps/web/src/features/gate-probe.ts",
    'import { Route } from "../routes/app.tsx";\n\nexport const probe = Route;\n',
    "root:lint",
    /no-restricted-imports/,
  );
  await refusesBadConfiguration(packed);
  await exercise(packed);
  checkDbPeerFloors(manifestPath, manifest);
  await exerciseConsumer(packages);
  checkDrizzleSkew(packages);
  process.stdout.write("published-shape: snapshot, packed, npm and skew consumers passed.\n");
}

try {
  await (releaseDirectory === undefined ? checkSnapshot() : checkReleaseTarballs(releaseDirectory));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
