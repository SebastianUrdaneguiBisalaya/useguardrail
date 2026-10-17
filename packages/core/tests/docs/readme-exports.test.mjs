import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Names exported from src/index.ts, both values and types. */
const exportedNames = (source) =>
  [
    ...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g),
  ].flatMap((match) =>
    match[1]
      .split(",")
      .map((name) =>
        name
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      )
      .filter(Boolean),
  );

describe("package README", () => {
  it("mentions every name the package exports, so the docs cannot fall behind the API", () => {
    const readme = read("../../README.md");
    const missing = exportedNames(read("../../src/index.ts")).filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(readme),
    );
    expect(missing).toEqual([]);
  });
});
