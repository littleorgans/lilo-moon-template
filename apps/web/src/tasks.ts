/**
 * The demo product's data, in one place because two unrelated things read it.
 *
 * The board renders it and the probe route counts it. Keeping it beside the board would mean the
 * probe, which renders nothing, importing a React component module to reach an array.
 */
export const TASKS = [
  { id: "scout", status: "done", title: "Scout baseline" },
  { id: "library", status: "done", title: "Library exemplar" },
  { id: "app", status: "todo", title: "Application exemplar" },
] as const;
