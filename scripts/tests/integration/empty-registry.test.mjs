import assert from "node:assert/strict";
import { fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { withEmptyRegistry } from "../../lib/empty-registry.mjs";
import { projectEnvironment, writeJson } from "../../lib/project-files.mjs";

const serverFile = new URL("../../lib/empty-registry-server.mjs", import.meta.url);
const packageManager = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url)),
).packageManager;

const request = (url) => fetch(url, { signal: AbortSignal.timeout(1000) });

async function waitForStop(url, deadline) {
  try {
    await request(url);
  } catch {
    return;
  }
  assert.ok(Date.now() < deadline, "registry kept serving after its parent died");
  await setTimeout(25);
  await waitForStop(url, deadline);
}

function killOrphan(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

await test("empty registries have distinct ports and close before success or failure returns", async () => {
  let first;
  let second;
  await withEmptyRegistry(async (registry) => {
    first = registry;
    await assert.rejects(
      withEmptyRegistry(async (other) => {
        second = other;
        assert.notEqual(first, second);
        assert.equal((await request(`${first}@littleorgans%2fdb`)).status, 404);
        assert.equal((await request(`${second}@littleorgans%2funknown`)).status, 404);
        throw new Error("consumer failed");
      }),
      /consumer failed/,
    );
    await assert.rejects(request(second));
    assert.equal((await request(first)).status, 404);
  });
  await assert.rejects(request(first));
});

await test("the registry exits when its parent is killed", async () => {
  const parent = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { fork } from "node:child_process";
       const child = fork(new URL(process.argv[1]), [], {
         execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"]
       });
       child.once("message", port => process.send({ port, pid: child.pid }));`,
      serverFile.href,
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  const exited = new Promise((resolve) => parent.once("exit", resolve));
  let orphan;
  try {
    const [{ port, pid }] = await once(parent, "message", { signal: AbortSignal.timeout(10_000) });
    orphan = pid;
    const url = `http://127.0.0.1:${port}/`;
    assert.equal((await request(url)).status, 404);
    parent.kill("SIGKILL");
    await exited;
    await waitForStop(url, Date.now() + 5000);
    orphan = undefined;
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    await exited;
    if (orphan !== undefined) killOrphan(orphan);
  }
});

await test("the registry exits if its parent disconnects before readiness", async () => {
  const server = fork(serverFile, [], {
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exited = once(server, "exit");
  server.disconnect();
  await exited;
});

await test("the empty scope registry fails an unpacked dependency and skips an optional one", async () => {
  const root = mkdtempSync(join(tmpdir(), "empty-registry-"));
  try {
    const packed = join(root, "packed");
    mkdirSync(packed);
    writeJson(join(packed, "package.json"), { name: "@littleorgans/probe", version: "1.0.0" });
    const consumer = join(root, "consumer");
    mkdirSync(consumer);
    writeJson(join(consumer, "package.json"), {
      private: true,
      packageManager,
      dependencies: { "@littleorgans/probe": "1.0.0" },
    });
    await withEmptyRegistry(async (registry) => {
      writeFileSync(join(consumer, ".npmrc"), `@littleorgans:registry=${registry}\n`);
      const config = {
        minimumReleaseAge: 1440,
        storeDir: join(root, "store"),
        cacheDir: join(root, "cache"),
      };
      const workspace = join(consumer, "pnpm-workspace.yaml");
      // A file directory is sufficient here: the negative proof exercises resolution, not packing.
      writeJson(workspace, { ...config, overrides: { "@littleorgans/probe": `file:${packed}` } });
      const install = () =>
        spawnSync("pnpm", ["install", "--ignore-scripts", "--lockfile-only"], {
          cwd: consumer,
          env: projectEnvironment(),
          encoding: "utf8",
          timeout: 30_000,
          killSignal: "SIGKILL",
        });
      const valid = install();
      assert.equal(valid.status, 0, `${valid.error ?? ""}\n${valid.stdout}${valid.stderr}`);
      writeJson(workspace, config);
      rmSync(join(consumer, "pnpm-lock.yaml"));
      const missing = install();
      assert.notEqual(missing.status, 0);
      assert.match(`${missing.stdout}${missing.stderr}`, /ERR_PNPM_FETCH_404/);
      assert.ok(missing.stdout.includes(registry), "missing override must hit the local registry");
      // What pnpm does with the optional peer it hoists past the overrides. It records a
      // minimumReleaseAge violation, fatal even for an optional package, only when it finds one.
      writeJson(join(consumer, "package.json"), {
        private: true,
        packageManager,
        optionalDependencies: { "@littleorgans/probe": "1.0.0" },
      });
      const optional = install();
      assert.equal(optional.status, 0, `${optional.stdout}${optional.stderr}`);
      assert.doesNotMatch(readFileSync(join(consumer, "pnpm-lock.yaml"), "utf8"), /probe/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
