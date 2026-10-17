import { describe, expect, it } from "vitest";
import type { EvaluationInput, RebacConfig } from "../../src/index.js";
import {
  createEngine,
  createRebacEvaluator,
  createRelationGraph,
  InvalidPolicyError,
} from "../../src/index.js";

const graph = createRelationGraph({
  rules: {
    viewer: {
      impliedBy: [
        "editor",
      ],
    },
  },
  tuples: [
    {
      object: "doc:1",
      relation: "editor",
      subject: "user:ana",
    },
    {
      object: "doc:2",
      relation: "viewer",
      subject: "user:bob",
    },
  ],
});

const rebac = createRebacEvaluator({
  graph,
  requirements: {
    doc: {
      read: "viewer",
      update: "editor",
    },
  },
});

const request = (
  subject: string,
  action: string,
  resource: EvaluationInput["resource"],
): EvaluationInput => ({
  action,
  context: {
    tenantId: "t1",
  },
  resource,
  subject: {
    id: subject,
  },
});

describe("createRebacEvaluator", () => {
  it("allows when the subject holds the required relation", () => {
    expect(
      rebac(
        request("user:ana", "update", {
          id: "1",
          type: "doc",
        }),
      )?.effect,
    ).toBe("allow");
    expect(
      rebac(
        request("user:ana", "read", {
          id: "1",
          type: "doc",
        }),
      )?.effect,
    ).toBe("allow");
  });

  it("has no opinion when the relation is missing (never denies)", () => {
    expect(
      rebac(
        request("user:bob", "update", {
          id: "2",
          type: "doc",
        }),
      ),
    ).toBeUndefined();
    expect(
      rebac(
        request("user:ana", "read", {
          id: "2",
          type: "doc",
        }),
      ),
    ).toBeUndefined();
  });

  it("has no opinion for unmapped actions, unmapped types, or resources without id", () => {
    expect(
      rebac(
        request("user:ana", "delete", {
          id: "1",
          type: "doc",
        }),
      ),
    ).toBeUndefined();
    expect(
      rebac(
        request("user:ana", "read", {
          id: "1",
          type: "invoice",
        }),
      ),
    ).toBeUndefined();
    expect(
      rebac(
        request("user:ana", "read", {
          type: "doc",
        }),
      ),
    ).toBeUndefined();
  });

  it("is not tricked by prototype property names as actions or types", () => {
    expect(
      rebac(
        request("user:ana", "toString", {
          id: "1",
          type: "doc",
        }),
      ),
    ).toBeUndefined();
    expect(
      rebac(
        request("user:ana", "read", {
          id: "1",
          type: "constructor",
        }),
      ),
    ).toBeUndefined();
  });

  it("default-denies through the engine", () => {
    const engine = createEngine({
      evaluators: [
        rebac,
      ],
    });
    expect(
      engine.evaluate(
        request("user:bob", "update", {
          id: "2",
          type: "doc",
        }),
      ).effect,
    ).toBe("deny");
  });

  it("rejects malformed configuration", () => {
    const bad = (config: unknown) => () =>
      createRebacEvaluator(config as RebacConfig);
    expect(bad(undefined)).toThrow(InvalidPolicyError);
    expect(
      bad({
        graph: {},
        requirements: {},
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        graph,
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        graph,
        requirements: {
          doc: "viewer",
        },
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      bad({
        graph,
        requirements: {
          doc: {
            read: "",
          },
        },
      }),
    ).toThrow(InvalidPolicyError);
  });
});
