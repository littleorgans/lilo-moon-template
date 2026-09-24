import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Choices } from "./choices.ts";
import { partsOf } from "./choices.ts";
import type { Template } from "./template.ts";
import {
  hasControlCharacters,
  matches,
  parseManifest,
  serializeManifest,
  substitute,
  TOKENS,
} from "./template.ts";

/** The target holds something besides an empty Git repository, and nothing may be overwritten. */
export class TargetNotEmptyError extends Error {
  constructor(readonly target: string) {
    super(`${target} is not empty. Choose a new directory, or an empty one.`);
  }
}

function values(choices: Choices): Map<string, string> {
  const result = new Map<string, string>([[TOKENS.project, choices.project]]);
  if (choices.web !== null) {
    result.set(TOKENS.web, choices.web.name);
    result.set(TOKENS.webPort, String(choices.web.port));
    result.set(TOKENS.organizationPolicy, choices.web.organizationPolicy);
  }
  if (choices.service !== null) {
    result.set(TOKENS.service, choices.service.name);
    result.set(TOKENS.servicePort, String(choices.service.port));
  }
  return result;
}

/**
 * Writes the files `choices` select into `target`, which must be missing or empty apart from
 * `.git`. Returns the paths written. Every file is created exclusively, so nothing that exists is
 * ever replaced.
 */
export function scaffold(template: Template, choices: Choices, target: string): string[] {
  if (existsSync(target) && readdirSync(target).some((entry) => entry !== ".git")) {
    throw new TargetNotEmptyError(target);
  }
  const parts = partsOf(choices);
  const replacements = values(choices);
  const selected = template.files
    .filter(({ when }) => matches(when, parts))
    .map((file) => {
      const path = substitute(file.path, replacements);
      if (
        path.includes("\\") ||
        hasControlCharacters(path) ||
        path.split("/").some((part) => ["", ".", "..", ".git"].includes(part)) ||
        /^[A-Za-z]:/.test(path)
      ) {
        throw new Error(`Unsafe template path: ${path}`);
      }
      return { path, content: file.content };
    });
  const written: string[] = [];
  for (const file of selected) {
    const path = file.path;
    const location = join(target, path);
    mkdirSync(dirname(location), { recursive: true });
    const content = substitute(file.content, replacements);
    writeFileSync(
      location,
      path.endsWith("package.json") ? serializeManifest(parseManifest(content)) : content,
      { flag: "wx" },
    );
    written.push(path);
  }
  return written;
}
