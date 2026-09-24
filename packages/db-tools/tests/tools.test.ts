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
  // A tool may reprint the URL in another form; build it so secretlint sees no literal credential.
  const reprinted = new URL("postgres://owner@db:5432/app");
  reprinted.password = target.password;
  const devUrl = new URL("postgres://postgres@127.0.0.1:5432/app");
  devUrl.password = "postgres";
  it("redacts URLs and passwords reprinted as credentials, but not bare words", () => {
    expect(
      redactUrls(`${url} ${reprinted.href} owner:encoded/secret@db password=query-secret`, [url]),
    ).toBe("*** postgres://owner:***@db:5432/app owner:***@db password=***");
    expect(redactUrls("bad-url", ["bad-url"])).toBe("***");
    // The dev container's password is `postgres`: redacting it bare would mangle every image name.
    expect(redactUrls("postgres:17-alpine", [devUrl.href])).toBe("postgres:17-alpine");
  });
  it("redacts both output streams even when a child echoes DATABASE_URL", () => {
    let output = "";
    const write = (text: string) => {
      output += text;
    };
    expect(() =>
      runTool(
        "sh",
        [
          "-c",
          'echo "$DATABASE_URL"; echo "owner:encoded/secret@db password=query-secret" >&2; exit 1',
        ],
        {
          missing,
          env: { DATABASE_URL: url },
          stdout: write,
          stderr: write,
        },
      ),
    ).toThrow(ToolFailedError);
    expect(output).toBe("***\nowner:***@db password=***\n");
  });
});

it("redacts re-encoded, quoted and overlapping credential values completely", () => {
  const target = new URL("postgres://owner@db/app");
  target.password = "prefix";
  target.searchParams.set("password", "prefix/suffix");
  expect(
    redactUrls("password=prefix%2Fsuffix password=prefix/suffix password='prefix/suffix'", [
      target.href,
    ]),
  ).toBe("password=*** password=*** password='***'");
});
