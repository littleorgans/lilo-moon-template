import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateTemplate } from "../src/generate/index.ts";
import type { Template } from "../src/template.ts";

/** This repository, whose reference app the template is generated from. */
export const repository = fileURLToPath(new URL("../../..", import.meta.url));

let generated: Template | undefined;

/** The template generated from this checkout, once per test file. */
export function template(): Template {
  generated ??= generateTemplate(repository);
  return generated;
}

export function scratch(): string {
  return mkdtempSync(join(tmpdir(), "create-app-test-"));
}
