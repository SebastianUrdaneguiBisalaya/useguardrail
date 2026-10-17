import { describe, expect, it } from "vitest";
import type {
  AbacPolicy,
  Condition,
  EvaluationInput,
} from "../../src/index.js";
import {
  createAbacEvaluator,
  createEngine,
  type InvalidPolicyError,
  MAX_CONDITION_DEPTH,
} from "../../src/index.js";

const input = (
  dept: string | undefined,
  level: number | undefined,
  overrides: Partial<EvaluationInput> = {},
): EvaluationInput => ({
  action: "read",
  context:
    level === undefined
      ? {}
      : {
          attributes: {
            level,
          },
        },
  resource: {
    attributes: {
      owner: "a",
    },
    type: "invoice",
  },
  subject: {
    id: "u",
    ...(dept === undefined
      ? {}
      : {
          attributes: {
            dept,
          },
        }),
  },
  ...overrides,
});

const dept = (value: string): Condition => ({
  field: "subject.attributes.dept",
  op: "eq",
  value,
});
const level = (op: "gt" | "lt", value: number): Condition => ({
  field: "context.attributes.level",
  op,
  value,
});

const allows = (condition: Condition, request: EvaluationInput): boolean =>
  createAbacEvaluator({
    policies: [
      {
        conditions: [
          condition,
        ],
        effect: "allow",
        id: "p",
      },
    ],
  })(request)?.effect === "allow";

describe("ABAC condition groups", () => {
  it("any: holds when at least one child holds (OR)", () => {
    const either = {
      any: [
        dept("a"),
        dept("b"),
      ],
    };
    expect(allows(either, input("a", 1))).toBe(true);
    expect(allows(either, input("b", 1))).toBe(true);
    expect(allows(either, input("c", 1))).toBe(false);
    expect(allows(either, input(undefined, 1))).toBe(false);
  });

  it("all: holds when every child holds (AND), same as listing them", () => {
    const both = {
      all: [
        dept("a"),
        level("gt", 2),
      ],
    };
    expect(allows(both, input("a", 3))).toBe(true);
    expect(allows(both, input("a", 1))).toBe(false);
    expect(allows(both, input("b", 3))).toBe(false);
  });

  it("not: negates the child", () => {
    const notA = {
      not: dept("a"),
    };
    expect(allows(notA, input("a", 1))).toBe(false);
    expect(allows(notA, input("b", 1))).toBe(true);
  });

  it("not turns a missing value into true (unlike neq, which needs the value)", () => {
    const notA = {
      not: dept("a"),
    };
    const neqA: Condition = {
      field: "subject.attributes.dept",
      op: "neq",
      value: "a",
    };
    expect(allows(notA, input(undefined, 1))).toBe(true);
    expect(allows(neqA, input(undefined, 1))).toBe(false);
  });

  it("nests: (dept a OR dept b) AND NOT level > 2", () => {
    const rule: Condition = {
      all: [
        {
          any: [
            dept("a"),
            dept("b"),
          ],
        },
        {
          not: level("gt", 2),
        },
      ],
    };
    expect(allows(rule, input("a", 1))).toBe(true);
    expect(allows(rule, input("b", 2))).toBe(true);
    expect(allows(rule, input("b", 3))).toBe(false);
    expect(allows(rule, input("c", 1))).toBe(false);
  });

  it("combines with the top-level AND list", () => {
    const policy: AbacPolicy = {
      conditions: [
        {
          any: [
            dept("a"),
            dept("b"),
          ],
        },
        level("lt", 5),
      ],
      effect: "allow",
      id: "p",
    };
    const evaluator = createAbacEvaluator({
      policies: [
        policy,
      ],
    });
    expect(evaluator(input("a", 1))?.effect).toBe("allow");
    expect(evaluator(input("a", 9))).toBeUndefined();
  });

  it("works in deny policies, and deny still wins", () => {
    const engine = createEngine({
      evaluators: [
        createAbacEvaluator({
          policies: [
            {
              effect: "allow",
              id: "everyone",
            },
            {
              conditions: [
                {
                  any: [
                    dept("contractor"),
                    {
                      not: level("gt", 0),
                    },
                  ],
                },
              ],
              effect: "deny",
              id: "restrict",
            },
          ],
        }),
      ],
    });
    expect(engine.evaluate(input("employee", 1)).effect).toBe("allow");
    expect(engine.evaluate(input("contractor", 1))).toMatchObject({
      code: "POLICY_DENIES",
      effect: "deny",
    });
    expect(engine.evaluate(input("employee", 0)).effect).toBe("deny");
  });
});

describe("ABAC condition group validation", () => {
  const create = (condition: unknown) => () =>
    createAbacEvaluator({
      policies: [
        {
          conditions: [
            condition as Condition,
          ],
          effect: "allow",
          id: "p",
        },
      ],
    });
  const code = (condition: unknown) => {
    try {
      create(condition)();
    } catch (error) {
      return (error as InvalidPolicyError).code;
    }
    return undefined;
  };

  it("rejects empty or non-array all / any", () => {
    expect(
      code({
        all: [],
      }),
    ).toBe("CONDITION_GROUP_INVALID");
    expect(
      code({
        any: [],
      }),
    ).toBe("CONDITION_GROUP_INVALID");
    expect(
      code({
        all: "x",
      }),
    ).toBe("CONDITION_GROUP_INVALID");
    expect(
      code({
        any: dept("a"),
      }),
    ).toBe("CONDITION_GROUP_INVALID");
  });

  it("rejects a node that is not exactly one of field / all / any / not", () => {
    expect(code({})).toBe("CONDITION_SHAPE_INVALID");
    expect(
      code({
        foo: 1,
      }),
    ).toBe("CONDITION_SHAPE_INVALID");
    expect(
      code({
        all: [
          dept("a"),
        ],
        any: [
          dept("b"),
        ],
      }),
    ).toBe("CONDITION_SHAPE_INVALID");
    expect(
      code({
        ...dept("a"),
        not: dept("b"),
      }),
    ).toBe("CONDITION_SHAPE_INVALID");
  });

  it("rejects non-object children, including inside groups", () => {
    expect(
      code({
        not: null,
      }),
    ).toBe("CONDITION_NOT_OBJECT");
    expect(
      code({
        not: [],
      }),
    ).toBe("CONDITION_NOT_OBJECT");
    expect(
      code({
        any: [
          dept("a"),
          5,
        ],
      }),
    ).toBe("CONDITION_NOT_OBJECT");
  });

  it("validates the leaves inside groups like any other leaf", () => {
    expect(
      code({
        not: {
          field: "subject.x",
          op: "regex",
          value: 1,
        },
      }),
    ).toBe("CONDITION_OPERATOR_UNKNOWN");
    expect(
      code({
        any: [
          {
            field: "other.x",
            op: "eq",
            value: 1,
          },
        ],
      }),
    ).toBe("CONDITION_FIELD_INVALID");
  });

  it("allows nesting up to the limit and rejects one level beyond", () => {
    const nest = (levels: number): Condition => {
      let node: Condition = dept("a");
      for (let i = 0; i < levels; i += 1) {
        node = {
          not: node,
        };
      }
      return node;
    };
    expect(MAX_CONDITION_DEPTH).toBe(8);
    expect(code(nest(MAX_CONDITION_DEPTH))).toBeUndefined();
    expect(code(nest(MAX_CONDITION_DEPTH + 1))).toBe("CONDITION_TOO_DEEP");
  });

  it("reports the depth limit and policy id as params", () => {
    try {
      createAbacEvaluator({
        policies: [
          {
            conditions: [
              ((): Condition => {
                let node: Condition = dept("a");
                for (let i = 0; i < 20; i += 1)
                  node = {
                    not: node,
                  };
                return node;
              })(),
            ],
            effect: "allow",
            id: "deep",
          },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidPolicyError).params).toEqual({
        maxDepth: MAX_CONDITION_DEPTH,
        policyId: "deep",
      });
    }
  });

  it("only reads own properties, so a polluted Object.prototype cannot add groups", () => {
    Object.defineProperty(Object.prototype, "not", {
      configurable: true,
      value: dept("a"),
      writable: true,
    });
    try {
      // A plain field comparison: without own-property reads it would also look like a `not`.
      expect(code(dept("a"))).toBeUndefined();
      expect(allows(dept("a"), input("a", 1))).toBe(true);
    } finally {
      Reflect.deleteProperty(Object.prototype, "not");
    }
  });
});
