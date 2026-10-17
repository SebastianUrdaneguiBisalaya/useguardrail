import { describe, expect, it } from "vitest";
import type { RelationTuple } from "../../src/index.js";
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

describe("wildcard subjects (<type>:*)", () => {
  const graph = createRelationGraph({
    tuples: [
      tuple("doc:public", "viewer", "user:*"),
      tuple("doc:private", "viewer", "user:ana"),
      tuple("doc:bots", "viewer", "bot:*"),
    ],
  });

  it("grants everyone of that type", () => {
    expect(graph.check("user:ana", "viewer", "doc:public")).toBe(true);
    expect(graph.check("user:bob", "viewer", "doc:public")).toBe(true);
  });

  it("does not grant other types, or other objects and relations", () => {
    expect(graph.check("bot:r2", "viewer", "doc:public")).toBe(false);
    expect(graph.check("user:ana", "editor", "doc:public")).toBe(false);
    expect(graph.check("user:bob", "viewer", "doc:private")).toBe(false);
    expect(graph.check("user:bob", "viewer", "doc:bots")).toBe(false);
    expect(graph.check("bot:r2", "viewer", "doc:bots")).toBe(true);
  });

  it("matches by the whole type prefix, not a shared start", () => {
    expect(graph.check("username:ana", "viewer", "doc:public")).toBe(false);
    expect(graph.check("user", "viewer", "doc:public")).toBe(false);
    expect(graph.check("user:", "viewer", "doc:public")).toBe(false);
  });

  it("does not let a querying wildcard match itself through another type's wildcard", () => {
    // Asking about the wildcard literally matches only a tuple that grants exactly that wildcard.
    expect(graph.check("user:*", "viewer", "doc:public")).toBe(true);
    expect(graph.check("bot:*", "viewer", "doc:public")).toBe(false);
  });

  it("works with implied relations and inheritance", () => {
    const g = createRelationGraph({
      rules: {
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
        tuple("folder:open", "viewer", "user:*"),
        tuple("doc:1", "parent", "folder:open"),
        tuple("doc:2", "editor", "user:*"),
      ],
    });
    expect(g.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(g.check("user:ana", "viewer", "doc:2")).toBe(true);
    expect(g.check("user:ana", "editor", "doc:1")).toBe(false);
  });

  it("works as a member of a userset", () => {
    const g = createRelationGraph({
      tuples: [
        tuple("doc:1", "viewer", "team:eng#member"),
        tuple("team:eng", "member", "user:*"),
      ],
    });
    expect(g.check("user:ana", "viewer", "doc:1")).toBe(true);
    expect(g.check("bot:r2", "viewer", "doc:1")).toBe(false);
  });

  it("rejects wildcard usersets and an empty type", () => {
    const create = (subject: string) => () =>
      createRelationGraph({
        tuples: [
          tuple("doc:1", "viewer", subject),
        ],
      });
    expect(create("team:*#member")).toThrow(InvalidPolicyError);
    expect(create(":*")).toThrow(InvalidPolicyError);
    expect(create("user:*")).not.toThrow();
  });

  it("treats a bare * or a ':*' in the middle as a plain reference", () => {
    const g = createRelationGraph({
      tuples: [
        tuple("doc:1", "viewer", "*"),
        tuple("doc:2", "viewer", "a:*:b"),
      ],
    });
    expect(g.check("anyone", "viewer", "doc:1")).toBe(false);
    expect(g.check("a:x", "viewer", "doc:2")).toBe(false);
    expect(g.check("*", "viewer", "doc:1")).toBe(true);
  });
});
