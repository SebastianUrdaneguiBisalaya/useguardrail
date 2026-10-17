import { describe, expect, it } from "vitest";
import type { EvaluationInput, Evaluator } from "../src/index.js";
import {
  AdapterMappingError,
  AuthorizationError,
  createAbacEvaluator,
  createAuthorizationStore,
  createContext,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  DECISION_CODES,
  ERROR_CODES,
  InvalidContextError,
  InvalidPolicyError,
} from "../src/index.js";

const input: EvaluationInput = {
  action: "read",
  context: {
    tenantId: "t1",
  },
  resource: {
    id: "1",
    type: "doc",
  },
  subject: {
    id: "user:ana",
    roles: [
      "viewer",
    ],
  },
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as AuthorizationError;
    return {
      code: e.code,
      params: e.params,
    };
  }
  throw new Error("expected a throw");
};

describe("error codes", () => {
  it("lists unique codes", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(new Set(DECISION_CODES).size).toBe(DECISION_CODES.length);
  });

  it("uses the class default code and empty frozen params when none are given", () => {
    expect(new AuthorizationError("x").code).toBe("AUTHORIZATION_ERROR");
    expect(new InvalidPolicyError("x").code).toBe("INVALID_POLICY");
    expect(new InvalidContextError("x").code).toBe("INVALID_CONTEXT");
    expect(new AdapterMappingError("x").code).toBe("ADAPTER_MAPPING");
    const error = new InvalidPolicyError("x");
    expect(error.params).toEqual({});
    expect(Object.isFrozen(error.params)).toBe(true);
  });

  it("accepts an explicit code, params, and cause", () => {
    const cause = new Error("root");
    const error = new InvalidPolicyError("x", {
      cause,
      code: "ROLE_INHERITANCE_CYCLE",
      params: {
        cycle: [
          "a",
          "b",
          "a",
        ],
      },
    });
    expect(error.code).toBe("ROLE_INHERITANCE_CYCLE");
    expect(error.params).toEqual({
      cycle: [
        "a",
        "b",
        "a",
      ],
    });
    expect(error.cause).toBe(cause);
  });

  it("copies params so later mutation cannot change them", () => {
    const params = {
      index: 1,
    };
    const error = new InvalidPolicyError("x", {
      params,
    });
    params.index = 2;
    expect(error.params).toEqual({
      index: 1,
    });
  });

  it("tags configuration errors with stable codes and params", () => {
    expect(
      codeOf(() =>
        createContext({
          tenantId: "",
        }),
      ),
    ).toEqual({
      code: "CONTEXT_TENANT_ID_INVALID",
      params: {},
    });
    expect(
      codeOf(() =>
        createEngine({
          evaluators: 1,
        } as never),
      ).code,
    ).toBe("EVALUATORS_INVALID");
    expect(
      codeOf(() =>
        createRbacEvaluator({
          roles: {
            a: {
              inherits: [
                "b",
              ],
              permissions: [],
            },
            b: {
              inherits: [
                "a",
              ],
              permissions: [],
            },
          },
        }),
      ),
    ).toEqual({
      code: "ROLE_INHERITANCE_CYCLE",
      params: {
        cycle: [
          "a",
          "b",
          "a",
        ],
      },
    });
    expect(
      codeOf(() =>
        createRbacEvaluator({
          roles: {
            a: {
              permissions: [
                "nocolon",
              ],
            },
          },
        }),
      ),
    ).toEqual({
      code: "PERMISSION_FORMAT_INVALID",
      params: {
        index: 0,
        role: "a",
      },
    });
    expect(
      codeOf(() =>
        createAbacEvaluator({
          policies: [
            {
              effect: "allow",
              id: "p",
            },
            {
              effect: "allow",
              id: "p",
            },
          ],
        }),
      ),
    ).toEqual({
      code: "POLICY_ID_DUPLICATE",
      params: {
        policyId: "p",
      },
    });
    expect(
      codeOf(() =>
        createAbacEvaluator({
          policies: [
            {
              conditions: [
                {
                  field: "subject.x",
                  op: "regex" as never,
                  value: 1,
                },
              ],
              effect: "allow",
              id: "p",
            },
          ],
        }),
      ),
    ).toEqual({
      code: "CONDITION_OPERATOR_UNKNOWN",
      params: {
        operator: "regex",
        policyId: "p",
      },
    });
    expect(
      codeOf(() =>
        createRelationGraph({
          tuples: [
            {
              object: "a",
              relation: "r",
              subject: "s#x#y",
            },
          ],
        }),
      ),
    ).toEqual({
      code: "TUPLE_REFERENCE_INVALID",
      params: {
        index: 0,
      },
    });
    expect(
      codeOf(() =>
        createRelationGraph({
          maxDepth: 0,
          tuples: [],
        }),
      ).code,
    ).toBe("GRAPH_MAX_DEPTH_INVALID");
    expect(
      codeOf(() =>
        createRebacEvaluator({
          graph: createRelationGraph({
            tuples: [],
          }),
          requirements: {
            doc: {
              read: "",
            },
          },
        }),
      ),
    ).toEqual({
      code: "REBAC_REQUIREMENT_INVALID",
      params: {
        action: "read",
        resourceType: "doc",
      },
    });
    expect(
      codeOf(() =>
        createAuthorizationStore({
          engine: {},
        } as never),
      ).code,
    ).toBe("ENGINE_REQUIRED");
  });

  it("never puts tuple values in tuple error params or messages", () => {
    try {
      createRelationGraph({
        tuples: [
          {
            object: "doc:secret-doc",
            relation: "r",
            subject: "user:secret-user#a#b",
          },
        ],
      });
      expect.unreachable();
    } catch (error) {
      const e = error as AuthorizationError;
      expect(e.message).not.toContain("secret");
      expect(JSON.stringify(e.params)).not.toContain("secret");
    }
  });
});

describe("decision codes", () => {
  const rbac = createRbacEvaluator({
    roles: {
      viewer: {
        permissions: [
          "doc:read",
        ],
      },
    },
  });

  it("tags RBAC, ABAC, and ReBAC decisions", () => {
    expect(rbac(input)).toMatchObject({
      code: "ROLE_GRANTS",
      params: {
        action: "read",
        resource: "doc",
        role: "viewer",
      },
    });
    const abac = createAbacEvaluator({
      policies: [
        {
          actions: [
            "read",
          ],
          effect: "allow",
          id: "yes",
        },
        {
          actions: [
            "delete",
          ],
          effect: "deny",
          id: "no",
        },
      ],
    });
    expect(abac(input)).toMatchObject({
      code: "POLICY_ALLOWS",
      params: {
        policyId: "yes",
      },
    });
    expect(
      abac({
        ...input,
        action: "delete",
      }),
    ).toMatchObject({
      code: "POLICY_DENIES",
      params: {
        policyId: "no",
      },
    });
    const rebac = createRebacEvaluator({
      graph: createRelationGraph({
        tuples: [
          {
            object: "doc:1",
            relation: "viewer",
            subject: "user:ana",
          },
        ],
      }),
      requirements: {
        doc: {
          read: "viewer",
        },
      },
    });
    expect(rebac(input)).toMatchObject({
      code: "RELATION_GRANTS",
      params: {
        object: "doc:1",
        relation: "viewer",
      },
    });
  });

  it("tags engine-made denials and keeps evaluator codes through the engine", () => {
    const boom: Evaluator = () => {
      throw new Error("x");
    };
    const bad = (() => ({
      effect: "maybe",
      reason: "x",
    })) as unknown as Evaluator;
    expect(
      createEngine({
        evaluators: [],
      }).evaluate(input).code,
    ).toBe("DEFAULT_DENY");
    expect(
      createEngine({
        evaluators: [
          boom,
        ],
      }).evaluate(input).code,
    ).toBe("EVALUATOR_FAILED");
    expect(
      createEngine({
        evaluators: [
          bad,
        ],
      }).evaluate(input).code,
    ).toBe("EVALUATOR_MALFORMED");
    expect(
      createEngine({
        evaluators: [
          rbac,
        ],
      }).evaluate(input),
    ).toMatchObject({
      code: "ROLE_GRANTS",
      effect: "allow",
      params: {
        role: "viewer",
      },
    });
  });

  it("passes custom evaluator codes through and rejects a non-string code", () => {
    const custom: Evaluator = () => ({
      code: "MY_CODE",
      effect: "allow",
      params: {
        tier: "gold",
      },
      reason: "custom",
    });
    expect(
      createEngine({
        evaluators: [
          custom,
        ],
      }).evaluate(input),
    ).toMatchObject({
      code: "MY_CODE",
      params: {
        tier: "gold",
      },
    });
    const invalid = (() => ({
      code: 5,
      effect: "allow",
      reason: "x",
    })) as unknown as Evaluator;
    expect(
      createEngine({
        evaluators: [
          invalid,
        ],
      }).evaluate(input).code,
    ).toBe("EVALUATOR_MALFORMED");
  });

  it("tags the no-subject denial from the store", () => {
    const store = createAuthorizationStore({
      engine: createEngine({
        evaluators: [
          rbac,
        ],
      }),
    });
    expect(
      store.evaluate("read", {
        id: "1",
        type: "doc",
      }).code,
    ).toBe("NO_SUBJECT");
  });
});
