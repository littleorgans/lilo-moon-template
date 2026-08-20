import { describe, expect, it } from "vitest";

import { groupBy, partition } from "../src/index.js";

describe("groupBy", () => {
  it("returns an empty map for empty input", () => {
    expect(groupBy([], (value) => value)).toEqual(new Map());
  });

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
  it("returns two empty arrays for empty input", () => {
    expect(partition([], () => true)).toEqual([[], []]);
  });

  it("passes each value and its encounter index to the predicate", () => {
    const [matching, remaining] = partition(
      new Set([10, 20, 30, 40]),
      (value, index) => value >= 20 && index % 2 === 0,
    );

    expect(matching).toEqual([30]);
    expect(remaining).toEqual([10, 20, 40]);
  });
});
