/**
 * Groups values by a derived key while preserving their encounter order.
 */
export function groupBy<Value, Key>(
  values: Iterable<Value>,
  selectKey: (value: Value) => Key,
): ReadonlyMap<Key, readonly Value[]> {
  const groups = new Map<Key, Value[]>();

  for (const value of values) {
    const key = selectKey(value);
    const group = groups.get(key);

    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }

  return groups;
}
