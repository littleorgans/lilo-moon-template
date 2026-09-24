import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";

/**
 * pnpm's optional-peer hoisting can look past file overrides. A 404 makes it skip that optional
 * peer, while required unpacked dependencies fail. Only each fixture's .npmrc selects this server;
 * no global registry settings change. A child keeps serving during synchronous install commands.
 */
export async function withEmptyRegistry(body) {
  const server = fork(new URL("./empty-registry-server.mjs", import.meta.url), [], {
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exited = new Promise((resolve) => {
    server.once("exit", resolve);
    server.once("error", resolve);
  });
  try {
    const [port] = await Promise.race([
      once(server, "message", { signal: AbortSignal.timeout(10_000) }),
      exited.then(() => {
        throw new Error("published-shape: the empty registry did not start");
      }),
    ]);
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, "Invalid registry port");
    return await body(`http://127.0.0.1:${port}/`);
  } finally {
    // No graceful shutdown is needed for a fixture that never writes anything. SIGKILL also
    // terminates the process on Windows. Await exit so the listener is gone before returning.
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    await exited;
  }
}
