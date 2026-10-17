import { describe, expect, it } from "vitest";
import type { RelationGraphConfig, RelationTuple } from "../../src/index.js";
import { createRelationGraph, InvalidPolicyError } from "../../src/index.js";

const tuple = (
  object: string,
  relation: string,
  subject: string,
): RelationTuple => ({
  object,
  relation,
  subject,
});

describe("createRelationGraph", () => {
  it("resolves direct tuples only for the exact subject, relation and object", () => {
    const graph = createRelationGraph({
      tuples: [
        tuple("doc:1", "viewer", "user:ana"),
      ],
    });
    expect(graph.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(graph.check("user:bob", "viewer", "doc:1")).toBe(false);
    expect(graph.check("user:ana", "editor", "doc:1")).toBe(false);
    expect(graph.check("user:ana", "viewer", "doc:2")).toBe(false);
  });

  it("resolves usersets, including nested ones", () => {
    const graph = createRelationGraph({
      tuples: [
        tuple("doc:1", "viewer", "team:eng#member"),
        tuple("team:eng", "member", "team:core#member"),
        tuple("team:core", "member", "user:ana"),
      ],
    });
    expect(graph.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(graph.check("user:bob", "viewer", "doc:1")).toBe(false);
  });

  it("resolves implied relations", () => {
    const graph = createRelationGraph({
      rules: {
        editor: {
          impliedBy: [
            "owner",
          ],
        },
        viewer: {
          impliedBy: [
            "editor",
          ],
        },
      },
      tuples: [
        tuple("doc:1", "owner", "user:ana"),
      ],
    });
    expect(graph.check("user:ana", "editor", "doc:1")).toBe(true);
    expect(graph.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(graph.check("user:ana", "owner", "doc:1")).toBe(true);
  });

  it("inherits relations through parent links", () => {
    const graph = createRelationGraph({
      rules: {
        viewer: {
          inheritFrom: [
            {
              relation: "viewer",
              via: "parent",
            },
          ],
        },
      },
      tuples: [
        tuple("folder:root", "viewer", "user:ana"),
        tuple("folder:sub", "parent", "folder:root"),
        tuple("doc:1", "parent", "folder:sub"),
      ],
    });
    expect(graph.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(graph.check("user:bob", "viewer", "doc:1")).toBe(false);
  });

  it("terminates on cycles and denies", () => {
    const graph = createRelationGraph({
      rules: {
        editor: {
          impliedBy: [
            "viewer",
          ],
        },
        viewer: {
          impliedBy: [
            "editor",
          ],
          inheritFrom: [
            {
              relation: "viewer",
              via: "parent",
            },
          ],
        },
      },
      tuples: [
        tuple("a", "parent", "b"),
        tuple("b", "parent", "a"),
        tuple("team:x", "member", "team:x#member"),
      ],
    });
    expect(graph.check("user:ana", "viewer", "a")).toBe(false);
    expect(graph.check("user:ana", "member", "team:x")).toBe(false);
  });

  it("respects maxDepth (fails closed)", () => {
    const tuples = [
      tuple("n0", "viewer", "user:ana"),
    ];
    for (let i = 1; i <= 5; i += 1) {
      tuples.push(tuple(`n${i}`, "parent", `n${i - 1}`));
    }
    const rules = {
      viewer: {
        inheritFrom: [
          {
            relation: "viewer",
            via: "parent",
          },
        ],
      },
    };
    expect(
      createRelationGraph({
        rules,
        tuples,
      }).check("user:ana", "viewer", "n5"),
    ).toBe(true);
    expect(
      createRelationGraph({
        maxDepth: 3,
        rules,
        tuples,
      }).check("user:ana", "viewer", "n5"),
    ).toBe(false);
  });

  it("is isolated from later mutation of the input", () => {
    const tuples = [
      tuple("doc:1", "viewer", "user:ana"),
    ];
    const graph = createRelationGraph({
      tuples,
    });
    tuples.push(tuple("doc:1", "viewer", "user:bob"));
    expect(graph.check("user:bob", "viewer", "doc:1")).toBe(false);
  });

  it("returns false for non-string arguments instead of throwing", () => {
    const graph = createRelationGraph({
      tuples: [],
    });
    expect(graph.check(undefined as never, "viewer", "doc:1")).toBe(false);
  });

  it("rejects malformed configuration", () => {
    const bad = (config: unknown) => () =>
      createRelationGraph(config as RelationGraphConfig);
    expect(bad(undefined)).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: "x",
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: [
          null,
        ],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: [
          {
            object: "a",
            relation: "r",
          },
        ],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: [
          tuple("a#b", "r", "s"),
        ],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: [
          tuple("a", "r", "s#"),
        ],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        tuples: [
          tuple("a", "r", "s#x#y"),
        ],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        rules: [],
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        rules: {
          r: null,
        },
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        rules: {
          r: {
            impliedBy: [
              1,
            ],
          },
        },
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        rules: {
          r: {
            inheritFrom: [
              {
                via: "p",
              },
            ],
          },
        },
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        maxDepth: 0,
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        maxDepth: 1.5,
        tuples: [],
      }),
    ).toThrow(InvalidPolicyError);
  });
});
