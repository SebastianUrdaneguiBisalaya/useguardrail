const FORBIDDEN_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Splits a dot path into segments, or returns `undefined` when it is empty or unsafe. */
export const parsePath = (path: unknown): readonly string[] | undefined => {
  if (typeof path !== "string") {
    return undefined;
  }
  const segments = path.split(".");
  if (
    segments.some(
      (segment) => segment === "" || FORBIDDEN_SEGMENTS.has(segment),
    )
  ) {
    return undefined;
  }
  return segments;
};

/** Reads own properties only, so inherited members (prototype chain) are never reachable. */
export const readPath = (
  root: unknown,
  segments: readonly string[],
): unknown => {
  let current = root;
  for (const segment of segments) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};
