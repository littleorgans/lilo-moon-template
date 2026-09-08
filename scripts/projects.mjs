import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createProject, planProject } from "./lib/create-project.mjs";
import { projectImpact } from "./lib/project-impact.mjs";
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
    from: { type: "string" },
    to: { type: "string" },
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
  just project-impact [--from <commit>] [--to <commit>] [--json]

Creation exports a committed revision, initializes Git, installs dependencies and registers
its origin. --no-install leaves setup pending. --remote sets origin locally; it creates no
hosted repository. --dry-run validates and prints the plan without writing files.
Impact defaults to each project's birth revision through the current working tree.
`;

function printImpact(report) {
  if (report.projects.length === 0) return "No generated projects registered.\n";
  return (
    report.projects
      .map((project) => {
        const lines = [
          `${project.name} (${project.id})`,
          `  ${project.status}: ${project.path ?? project.repository ?? "no checkout registered"}`,
        ];
        if (project.reason) lines.push(`  ${project.reason}`);
        if (project.changes) {
          for (const change of project.changes)
            lines.push(`  ${change.state.padEnd(15)} ${change.path}`);
          lines.push(
            `  Manifest consumers to inspect: ${project.manifestDependents.map(({ path }) => path).join(", ") || "none identified"}`,
          );
          lines.push(`  Dependency coverage: ${project.dependencyCoverage}`);
          if (project.changes.length === 0)
            lines.push("  No template file changes in this comparison.");
        } else if (project.changedTemplateFiles)
          lines.push(
            `  ${project.changedTemplateFiles.length} template files changed; checkout inspection unavailable.`,
          );
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

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
        : records
            .map(
              (project) =>
                `${project.name}\t${project.templateRevision.slice(0, 12)}\t${project.path ?? project.repository ?? "checkout unavailable"}`,
            )
            .join("\n") + "\n",
    );
  } else if (command === "impact" && positionals.length === 1) {
    const report = projectImpact(source, { from: values.from, to: values.to });
    process.stdout.write(
      values.json ? `${JSON.stringify(report, null, 2)}\n` : printImpact(report),
    );
  } else throw new Error(help);
} catch (error) {
  process.stderr.write(`${error.message}\n${error.cause?.message ?? ""}\n`);
  process.exitCode = 1;
}
