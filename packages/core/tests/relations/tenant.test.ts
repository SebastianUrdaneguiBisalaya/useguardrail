import { describe, expect, it } from "vitest";
import type { EvaluationInput } from "../../src/index.js";
import {
  createEngine,
  createRebacEvaluator,
  createTenantRelationGraph,
  InvalidPolicyError,
} from "../../src/index.js";

const graph = createTenantRelationGraph({
  rules: {
    viewer: {
      impliedBy: [
        "editor",
      ],
    },
  },
  tuples: {
    acme: [
      {
        object: "doc:1",
        relation: "editor",
        subject: "user:ana",
      },
      {
        object: "doc:public",
        relation: "viewer",
        subject: "user:*",
      },
    ],
    globex: [
      {
        object: "doc:1",
        relation: "viewer",
        subject: "user:bob",
      },
    ],
  },
});

describe("createTenantRelationGraph", () => {
  it("keeps tenants completely separate, even with identical references", () => {
    expect(graph.check("acme", "user:ana", "viewer", "doc:1")).toBe(true);
    expect(graph.check("globex", "user:ana", "viewer", "doc:1")).toBe(false);
    expect(graph.check("globex", "user:bob", "viewer", "doc:1")).toBe(true);
    expect(graph.check("acme", "user:bob", "viewer", "doc:1")).toBe(false);
    // A wildcard in one tenant is not public in another.
    expect(graph.check("acme", "user:zed", "viewer", "doc:public")).toBe(true);
    expect(graph.check("globex", "user:zed", "viewer", "doc:public")).toBe(
      false,
    );
  });

  it("shares the rules across tenants", () => {
    expect(graph.forTenant("acme")?.check("user:ana", "viewer", "doc:1")).toBe(
      true,
    );
  });

  it("treats an unknown tenant as having no relations", () => {
    expect(graph.forTenant("nope")).toBeUndefined();
    expect(graph.check("nope", "user:ana", "viewer", "doc:1")).toBe(false);
    expect(graph.check(undefined as never, "user:ana", "viewer", "doc:1")).toBe(
      false,
    );
  });

  it("lists its tenants and does not expose prototype names as tenants", () => {
    expect(graph.tenants()).toEqual([
      "acme",
      "globex",
    ]);
    expect(graph.forTenant("constructor")).toBeUndefined();
    expect(graph.forTenant("__proto__")).toBeUndefined();
  });

  it("names the tenant when its tuples are invalid", () => {
    try {
      createTenantRelationGraph({
        tuples: {
          acme: [],
          broken: [
            {
              object: "a#b",
              relation: "r",
              subject: "s",
            },
          ],
        },
      });
      expect.unreachable();
    } catch (error) {
      const e = error as InvalidPolicyError;
      expect(e).toBeInstanceOf(InvalidPolicyError);
      expect(e.code).toBe("TUPLE_REFERENCE_INVALID");
      expect(e.params).toMatchObject({
        index: 0,
        tenantId: "broken",
      });
      expect(e.message).toContain('Tenant "broken"');
    }
  });

  it("rejects malformed configuration", () => {
    const create = (config: unknown) => () =>
      createTenantRelationGraph(config as never);
    expect(create(undefined)).toThrow(
      expect.objectContaining({
        code: "TENANT_GRAPH_INVALID",
      }),
    );
    expect(
      create({
        tuples: [],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "TENANT_GRAPH_INVALID",
      }),
    );
    expect(
      create({
        tuples: {
          "": [],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "TENANT_ID_INVALID",
      }),
    );
    expect(
      create({
        tuples: {
          acme: "x",
        },
      }),
    ).toThrow(InvalidPolicyError);
  });
});

describe("createRebacEvaluator with a tenant graph", () => {
  const rebac = createRebacEvaluator({
    graph,
    requirements: {
      doc: {
        read: "viewer",
      },
    },
  });
  const engine = createEngine({
    evaluators: [
      rebac,
    ],
  });
  const request = (
    tenantId: string | undefined,
    userId: string,
    docId = "1",
  ): EvaluationInput => ({
    action: "read",
    context:
      tenantId === undefined
        ? {}
        : {
            tenantId,
          },
    resource: {
      id: docId,
      type: "doc",
    },
    subject: {
      id: userId,
    },
  });

  it("uses the graph of context.tenantId", () => {
    expect(engine.evaluate(request("acme", "user:ana")).effect).toBe("allow");
    expect(engine.evaluate(request("globex", "user:ana")).effect).toBe("deny");
    expect(engine.evaluate(request("globex", "user:bob")).effect).toBe("allow");
    expect(engine.evaluate(request("acme", "user:zed", "public")).effect).toBe(
      "allow",
    );
  });

  it("has no opinion without a tenant, or for an unknown one (so the result is deny)", () => {
    expect(rebac(request(undefined, "user:ana"))).toBeUndefined();
    expect(rebac(request("nope", "user:ana"))).toBeUndefined();
    expect(rebac(request("", "user:ana"))).toBeUndefined();
  });

  it("does not take the tenant from a polluted Object.prototype", () => {
    Object.defineProperty(Object.prototype, "tenantId", {
      configurable: true,
      value: "acme",
      writable: true,
    });
    try {
      expect(rebac(request(undefined, "user:ana"))).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, "tenantId");
    }
  });

  it("still accepts a single graph, and rejects something that is neither", () => {
    expect(() =>
      createRebacEvaluator({
        graph: {} as never,
        requirements: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: "REBAC_GRAPH_REQUIRED",
      }),
    );
  });
});
