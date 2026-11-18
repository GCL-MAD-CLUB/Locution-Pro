export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export function equal(actual: unknown, expected: unknown, message: string) {
  const serialize = (value: unknown) =>
    JSON.stringify(value, (_, entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    });
  if (serialize(actual) !== serialize(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}
