import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createProject, planProject } from "./lib/create-project.mjs";
import { projectRecords, registerProject } from "./lib/project-registry.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dest: { type: "string" },
    org: { type: "string" },
    scope: { type: "string" },
    ref: { type: "string" },
    remote: { type: "string" },
    "no-install": { type: "boolean" },
    "dry-run": { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [command, argument] = positionals;
const help = `Usage:
  just new-project <name> --dest <parent> --org <organization> [--scope <scope>]
    [--ref <commit>] [--remote <url>] [--no-install] [--dry-run]
  just projects [--json]
  just project-register <checkout>

Creation preserves template history and sets origin to the project and upstream to the template.
--remote overrides the default git@github.com:<organization>/<name>.git project origin.
No hosted repository is created. --no-install leaves setup pending.
--dry-run validates and prints the plan without writing files.
`;

try {
  if (values.help || !command) process.stdout.write(help);
  else if (
    command === "create" &&
    argument &&
    positionals.length === 2 &&
    values.dest &&
    values.org
  ) {
    const options = {
      source,
      name: argument,
      destination: resolve(values.dest, argument),
      org: values.org,
      scope: values.scope,
      ref: values.ref,
      remote: values.remote,
      install: !values["no-install"],
    };
    const result = values["dry-run"] ? planProject(options) : createProject(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "register" && argument && positionals.length === 2) {
    process.stdout.write(
      `${JSON.stringify(registerProject(source, resolve(argument)), null, 2)}\n`,
    );
  } else if (command === "list" && positionals.length === 1) {
    const records = projectRecords(source);
    process.stdout.write(
      values.json
        ? `${JSON.stringify(records, null, 2)}\n`
        : records.length === 0
          ? "No downstream projects registered.\n"
          : records
              .map(
                (project) =>
                  `${project.name}\t${project.templateRevision.slice(0, 12)}\t${project.repository ?? "no remote"}\t${project.path ?? "checkout unavailable"}`,
              )
              .join("\n") + "\n",
    );
  } else throw new Error(help);
} catch (error) {
  process.stderr.write(`${error.message}\n${error.cause?.message ?? ""}\n`);
  process.exitCode = 1;
}
