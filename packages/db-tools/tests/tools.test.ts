import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MissingToolError, ToolFailedError, runTool } from "../src/tools.js";

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
