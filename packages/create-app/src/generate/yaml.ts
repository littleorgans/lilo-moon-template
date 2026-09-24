import { isDeepStrictEqual } from "node:util";

import { isNode, isScalar, isSeq, parseDocument } from "yaml";
import type { Document } from "yaml";

export type YamlPath = readonly (string | number)[];

/** A YAML file as an editable document that keeps its comments. */
export function parseYaml(text: string, file: string): Document {
  const document = parseDocument(text);
  if (document.errors.length > 0) throw new Error(`${file}: ${document.errors[0]?.message}`);
  return document;
}

/** The plain value at `path`: a scalar, or a collection as JavaScript objects and arrays. */
export function valueAt(document: Document, path: YamlPath): unknown {
  const found: unknown = document.getIn(path, true);
  return isNode(found) ? found.toJSON() : found;
}

/**
 * Asserts the reference still holds `expected` at `path` before the generator changes it, so an
 * edit never lands on a value the reference no longer has.
 */
export function expectAt(document: Document, path: YamlPath, expected: unknown, file: string) {
  const actual = valueAt(document, path);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${file}: expected ${path.join(".")} to be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}. Update the create-app generator to match the reference.`,
    );
  }
}

/** Replaces the value at `path`, which must currently be `expected`. */
export function replaceAt(
  document: Document,
  edit: {
    readonly path: YamlPath;
    readonly expected: unknown;
    readonly value: unknown;
    readonly file: string;
  },
) {
  expectAt(document, edit.path, edit.expected, edit.file);
  document.setIn(edit.path, edit.value);
}

/** Removes the entry at `path`, which must currently be `expected`. */
export function removeAt(
  document: Document,
  edit: { readonly path: YamlPath; readonly expected: unknown; readonly file: string },
) {
  expectAt(document, edit.path, edit.expected, edit.file);
  document.deleteIn(edit.path);
}

/** The keys of the mapping at `path`. */
export function keysAt(document: Document, path: YamlPath, file: string): string[] {
  const value = valueAt(document, path);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: ${path.join(".")} is not a mapping`);
  }
  return Object.keys(value);
}

/**
 * Edits the sequence at `path` item by item, so comments on the items that stay are kept.
 * `edits` maps each existing item to its replacement, or to null to remove it; every item it
 * names must be present.
 */
export function editSequence(
  document: Document,
  edit: {
    readonly path: YamlPath;
    readonly items: ReadonlyMap<string, string | null>;
    readonly file: string;
  },
) {
  const sequence: unknown = document.getIn(edit.path, true);
  if (!isSeq(sequence)) throw new Error(`${edit.file}: ${edit.path.join(".")} is not a sequence`);
  for (const [item, replacement] of edit.items) {
    const index = sequence.items.findIndex((node) => isScalar(node) && node.value === item);
    const node = sequence.items[index];
    if (!isScalar(node)) {
      throw new Error(
        `${edit.file}: ${edit.path.join(".")} no longer lists ${item}. Update the create-app generator to match the reference.`,
      );
    }
    if (replacement === null) sequence.items.splice(index, 1);
    else node.value = replacement;
  }
}

export function printYaml(document: Document): string {
  // No folding: the formatter the build runs afterwards owns line breaks.
  return document.toString({ lineWidth: 0 });
}
