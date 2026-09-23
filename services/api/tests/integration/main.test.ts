import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { run, stopOnSignals } from "../../src/main.ts";
import type { Host } from "../../src/main.ts";
import type { RunningService } from "../../src/server/service.ts";
import { recordingLog } from "../support.ts";

const entry = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

// Nothing listens on port 1, and the pool connects lazily, so these environments start without a
// database. Requests that reach it would fail as 503 unavailable; these tests send none.
async function environment() {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return {
    PORT: String(address.port),
    DATABASE_URL: "postgres://api:pw@127.0.0.1:1/app",
    WORKOS_CLIENT_ID: "client_TEST",
  };
}

/** `process`, as far as the entry point can tell. */
function host(env: Host["env"]): Host & EventEmitter {
  return Object.assign(new EventEmitter(), { env, exitCode: undefined });
}

function stoppable(stop: () => Promise<void>) {
  let stops = 0;
  const service: RunningService = {
    port: 0,
    stop: async () => {
      stops += 1;
      await stop();
    },
  };
  return { service, stops: () => stops };
}

describe("run", () => {
  it("starts on the configured port and stops gracefully on SIGTERM", async () => {
    const env = await environment();
    const { log, records } = recordingLog();
    const process = host(env);

    const service = await run(process, log);
    expect(service?.port).toBe(Number(env.PORT));
    expect((await fetch(`http://127.0.0.1:${env.PORT}/health`)).status).toBe(200);
    process.emit("SIGTERM");
    await service?.stop();

    expect(process.exitCode).toBeUndefined();
    expect(records.map((record) => record.event)).toStrictEqual([
      "listening",
      "request",
      "signal",
      "shutdown_started",
      "shutdown_complete",
    ]);
  });

  it("sets exit code 1 for an invalid environment without listening", async () => {
    const { log, records } = recordingLog();
    const process = host({ PORT: "0" });

    expect(await run(process, log)).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(records.map((record) => record.event)).toStrictEqual(["config_invalid"]);
    expect(process.listenerCount("SIGTERM")).toBe(0);
  });
});

describe("stopOnSignals", () => {
  it("stops once on the first SIGTERM or SIGINT and leaves the second to Node", () => {
    const process = host({});
    const { service, stops } = stoppable(() => Promise.resolve());
    stopOnSignals(service, process, recordingLog().log);

    process.emit("SIGINT");
    expect(stops()).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(1);
  });

  it.each([
    ["an error, by its name", new RangeError("pool: secret detail"), "RangeError"],
    ["anything else, by its type", "secret detail", "string"],
  ])("logs a failed shutdown of %s and sets exit code 1", async (_, failure, name) => {
    const process = host({});
    const { log, records } = recordingLog();
    const failed = Promise.withResolvers<void>();
    const { service } = stoppable(async () => {
      failed.resolve();
      await Promise.reject(failure);
    });
    stopOnSignals(service, process, log);

    process.emit("SIGTERM");
    await failed.promise;
    await new Promise((resolve) => setImmediate(resolve));

    expect(process.exitCode).toBe(1);
    expect(records).toStrictEqual([
      { level: "info", event: "signal", signal: "SIGTERM" },
      { level: "error", event: "shutdown_failed", name },
    ]);
  });
});

// The real entry point, run the way `moon run api:dev` runs it: Node strips the types itself.
function spawnEntry(env: Record<string, string>) {
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  const listening = new Promise<void>((resolve) => {
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8").on("data", (chunk: string) => {
        lines.push(...chunk.split("\n").filter(Boolean));
        if (chunk.includes('"event":"listening"')) resolve();
      });
    }
  });
  return { child, listening, exited: once(child, "exit"), lines };
}

describe("the process", () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "exits 0 on its own after %s, having logged every step as a JSON line",
    async (signal) => {
      const env = await environment();
      const { child, listening, exited, lines } = spawnEntry(env);
      await listening;

      const unauthenticated = await fetch(`http://127.0.0.1:${env.PORT}/v1/account`);
      expect(unauthenticated.status).toBe(401);
      child.kill(signal);

      expect(await exited).toStrictEqual([0, null]);
      expect(lines.map((line) => /"event":"(\w+)"/.exec(line)?.[1])).toStrictEqual([
        "listening",
        "auth_rejected",
        "request",
        "signal",
        "shutdown_started",
        "shutdown_complete",
      ]);
    },
    15_000,
  );

  it("exits 1 with one config_invalid line when the environment is wrong", async () => {
    const { exited, lines } = spawnEntry({ PORT: "eighty" });

    expect(await exited).toStrictEqual([1, null]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "error", event: "config_invalid" });
  }, 15_000);
});
