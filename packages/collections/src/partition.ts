export type Partition<Value> = readonly [matching: readonly Value[], remaining: readonly Value[]];

/**
 * Splits values into those that satisfy a predicate and those that do not.
 */
export function partition<Value>(
  values: Iterable<Value>,
  predicate: (value: Value, index: number) => boolean,
): Partition<Value> {
  const matching: Value[] = [];
  const remaining: Value[] = [];
  let index = 0;

  for (const value of values) {
    if (predicate(value, index)) {
      matching.push(value);
    } else {
      remaining.push(value);
    }

    index += 1;
  }

  return [matching, remaining];
}
