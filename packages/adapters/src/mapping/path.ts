import { AdapterMappingError } from "@useguardril/core";

const FORBIDDEN_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** A dot path split into segments, e.g. `"user.profile.id"`. */
export type Path = readonly string[];

/**
 * Validates a dot path from adapter configuration. `label` names the option it came from
 * (e.g. `"subjectId"`) so errors point at the misconfiguration.
 */
export const compilePath = (path: unknown, label: string): Path => {
  if (typeof path !== "string" || path === "") {
    throw new AdapterMappingError(`${label}: expected a non-empty dot path.`);
  }
  const segments = path.split(".");
  if (
    segments.some(
      (segment) => segment === "" || FORBIDDEN_SEGMENTS.has(segment),
    )
  ) {
    throw new AdapterMappingError(`${label}: invalid path "${path}".`);
  }
  return segments;
};

/** Reads own properties only, so the prototype chain is never reachable. */
export const readPath = (root: unknown, path: Path): unknown => {
  let current = root;
  for (const segment of path) {
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

/** Accepts non-empty strings and finite numbers (many backends use numeric ids). */
export const toIdentifier = (value: unknown): string | undefined => {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

/**
 * Resolves the array of records to map: the value at `path`, or the response itself when
 * no path is given. Fails without echoing any response data.
 */
export const readList = (
  response: unknown,
  path: Path | undefined,
  label: string,
): readonly unknown[] => {
  const value = path === undefined ? response : readPath(response, path);
  if (!Array.isArray(value)) {
    throw new AdapterMappingError(
      path === undefined
        ? `${label}: expected the response to be an array.`
        : `${label}: expected an array at "${path.join(".")}".`,
    );
  }
  return value;
};
