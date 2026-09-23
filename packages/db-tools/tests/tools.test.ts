import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MissingToolError, ToolFailedError, redactUrls, runTool } from "../src/tools.js";

const missing = "install it";

describe("runTool", () => {
  it("returns when the tool succeeds", () => {
    expect(() => runTool("sh", ["-c", "exit 0"], { missing })).not.toThrow();
  });

  it("names how to install a tool that is not on PATH", () => {
    expect(() => runTool("no-such-db-tool", [], { missing })).toThrow(
      new MissingToolError(missing),
    );
  });

  it("reports an exit code, a signal, and a tool that cannot run as a failure", () => {
    expect(() => runTool("sh", ["-c", "exit 3"], { missing })).toThrow(
      new ToolFailedError("sh -c exited with 3"),
    );
    expect(() => runTool("sh", ["-c", "kill -TERM $$"], { missing })).toThrow(
      new ToolFailedError("sh -c exited with SIGTERM"),
    );
    const notExecutable = join(mkdtempSync(join(tmpdir(), "db-tools-tool-")), "tool");
    writeFileSync(notExecutable, "");
    expect(() => runTool(notExecutable, [], { missing })).toThrow(ToolFailedError);
  });
});

describe("connection credentials", () => {
  const target = new URL("postgres://owner@db/app");
  target.password = "encoded/secret";
  target.searchParams.set("password", "query-secret");
  const url = target.href;
  it("redacts URLs, encoded and decoded passwords, and malformed URLs", () => {
    expect(redactUrls(`${url} encoded%2Fsecret encoded/secret query-secret`, [url])).toBe(
      "*** *** *** ***",
    );
    expect(redactUrls("bad-url", ["bad-url"])).toBe("***");
  });
  it("redacts both output streams even when a child echoes DATABASE_URL", () => {
    let output = "";
    const write = (text: string) => {
      output += text;
    };
    expect(() =>
      runTool(
        "sh",
        ["-c", 'echo "$DATABASE_URL"; echo "encoded/secret query-secret" >&2; exit 1'],
        {
          missing,
          env: { DATABASE_URL: url },
          stdout: write,
          stderr: write,
        },
      ),
    ).toThrow(ToolFailedError);
    expect(output).toBe("***\n*** ***\n");
  });
});
