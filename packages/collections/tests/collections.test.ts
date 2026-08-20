import { describe, expect, it } from "vitest";

import { groupBy, partition } from "../src/index.js";

describe("groupBy", () => {
  it("preserves group and value encounter order", () => {
    const events = [
      { kind: "deploy", id: 1 },
      { kind: "review", id: 2 },
      { kind: "deploy", id: 3 },
    ];

    const groups = groupBy(events, (event) => event.kind);

    expect([...groups]).toEqual([
      ["deploy", [events[0], events[2]]],
      ["review", [events[1]]],
    ]);
  });
});

describe("partition", () => {
  it("passes each value and its encounter index to the predicate", () => {
    const [matching, remaining] = partition(
      new Set([10, 20, 30, 40]),
      (_, index) => index % 2 === 0,
    );

    expect(matching).toEqual([10, 30]);
    expect(remaining).toEqual([20, 40]);
  });
});
