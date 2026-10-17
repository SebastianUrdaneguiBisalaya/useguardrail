import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  AbacPolicy,
  Condition,
  EvaluationInput,
  FieldCondition,
} from "../../src/index.js";
import {
  createAbacEvaluator,
  createEngine,
  InvalidPolicyError,
} from "../../src/index.js";

const FIELDS = [
  "subject.attributes.dept",
  "resource.attributes.owner",
  "context.attributes.level",
] as const;

const leafArb: fc.Arbitrary<FieldCondition> = fc.oneof(
  fc.record({
    field: fc.constant("subject.attributes.dept"),
    op: fc.constantFrom("eq", "neq", "contains"),
    value: fc.constantFrom("a", "b"),
  }),
  fc.record({
    field: fc.constant("subject.attributes.dept"),
    op: fc.constantFrom("in", "nin"),
    value: fc.subarray([
      "a",
      "b",
      "c",
    ]),
  }),
  fc.record({
    field: fc.constant("context.attributes.level"),
    op: fc.constantFrom("gt", "gte", "lt", "lte", "eq"),
    value: fc.integer({
      max: 4,
      min: 0,
    }),
  }),
  fc.record({
    field: fc.constantFrom(...FIELDS),
    op: fc.constant("exists"),
    value: fc.boolean(),
  }),
  fc.record({
    field: fc.constant("subject.attributes.dept"),
    op: fc.constantFrom("eq", "neq"),
    valueFrom: fc.constant("resource.attributes.owner"),
  }),
);

/** Field comparisons combined with all / any / not, up to three levels deep. */
const conditionArb: fc.Arbitrary<Condition> = fc.letrec<{
  node: Condition;
}>((tie) => ({
  node: fc.oneof(
    {
      depthSize: "small",
      maxDepth: 3,
    },
    leafArb,
    fc.record({
      all: fc.array(tie("node"), {
        maxLength: 3,
        minLength: 1,
      }),
    }),
    fc.record({
      any: fc.array(tie("node"), {
        maxLength: 3,
        minLength: 1,
      }),
    }),
    fc.record({
      not: tie("node"),
    }),
  ),
})).node;

const policiesArb = fc
  .array(
    fc.record({
      actions: fc.option(
        fc.subarray([
          "read",
          "write",
          "delete",
          "*",
        ]),
        {
          nil: undefined,
        },
      ),
      conditions: fc.array(conditionArb, {
        maxLength: 3,
      }),
      effect: fc.constantFrom("allow", "deny"),
      resources: fc.option(
        fc.subarray([
          "t1",
          "t2",
          "*",
        ]),
        {
          nil: undefined,
        },
      ),
    }),
    {
      maxLength: 8,
    },
  )
  .map((list): AbacPolicy[] =>
    list.map((policy, index) => ({
      conditions: policy.conditions,
      effect: policy.effect,
      id: `p${index}`,
      ...(policy.actions === undefined
        ? {}
        : {
            actions: policy.actions,
          }),
      ...(policy.resources === undefined
        ? {}
        : {
            resources: policy.resources,
          }),
    })),
  );

const inputArb: fc.Arbitrary<EvaluationInput> = fc.record({
  action: fc.constantFrom("read", "write", "delete"),
  context: fc.record({
    attributes: fc.record(
      {
        level: fc.integer({
          max: 4,
          min: 0,
        }),
      },
      {
        requiredKeys: [],
      },
    ),
  }),
  resource: fc.record({
    attributes: fc.record(
      {
        owner: fc.constantFrom("a", "b"),
      },
      {
        requiredKeys: [],
      },
    ),
    type: fc.constantFrom("t1", "t2"),
  }),
  subject: fc.record({
    attributes: fc.record(
      {
        dept: fc.constantFrom("a", "b", "c"),
      },
      {
        requiredKeys: [],
      },
    ),
    id: fc.constant("u"),
  }),
});

// ---- Reference implementation: deliberately naive. ----

const lookup = (input: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current === null || typeof current !== "object"
          ? undefined
          : (current as Record<string, unknown>)[segment],
      input,
    );

const holdsField = (
  condition: FieldCondition,
  input: EvaluationInput,
): boolean => {
  const left = lookup(input, condition.field);
  if (condition.op === "exists") {
    return (left !== undefined) === condition.value;
  }
  const right =
    condition.valueFrom === undefined
      ? condition.value
      : lookup(input, condition.valueFrom);
  if (left === undefined || right === undefined) return false;
  switch (condition.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "in":
      return (right as unknown[]).includes(left);
    case "nin":
      return !(right as unknown[]).includes(left);
    case "contains":
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.includes(right)
      );
    case "gt":
      return (left as number) > (right as number);
    case "gte":
      return (left as number) >= (right as number);
    case "lt":
      return (left as number) < (right as number);
    case "lte":
      return (left as number) <= (right as number);
    default:
      return false;
  }
};

const holds = (condition: Condition, input: EvaluationInput): boolean => {
  if ("all" in condition) {
    return condition.all.every((child) => holds(child, input));
  }
  if ("any" in condition) {
    return condition.any.some((child) => holds(child, input));
  }
  if ("not" in condition) {
    return !holds(condition.not, input);
  }
  return holdsField(condition, input);
};

const inScope = (
  scope: readonly string[] | undefined,
  value: string,
): boolean =>
  scope === undefined || scope.includes("*") || scope.includes(value);

const reference = (
  policies: AbacPolicy[],
  input: EvaluationInput,
):
  | {
      effect: "allow" | "deny";
      policyId: string;
    }
  | undefined => {
  let allowedBy: string | undefined;
  for (const policy of policies) {
    if (
      !inScope(policy.actions, input.action) ||
      !inScope(policy.resources, input.resource.type) ||
      !(policy.conditions ?? []).every((c) => holds(c, input))
    ) {
      continue;
    }
    if (policy.effect === "deny")
      return {
        effect: "deny",
        policyId: policy.id,
      };
    allowedBy ??= policy.id;
  }
  return allowedBy === undefined
    ? undefined
    : {
        effect: "allow",
        policyId: allowedBy,
      };
};

describe("ABAC properties", () => {
  it("agrees with a naive reference on the effect and the deciding policy, across many requests", () => {
    fc.assert(
      fc.property(
        policiesArb,
        fc.array(inputArb, {
          maxLength: 12,
          minLength: 1,
        }),
        (policies, inputs) => {
          const evaluator = createAbacEvaluator({
            policies,
          });
          // Many inputs against one evaluator also exercises the scope index and its cache.
          for (const input of inputs) {
            const decision = evaluator(input);
            const expected = reference(policies, input);
            expect(decision?.effect).toBe(expected?.effect);
            expect(
              (
                decision?.params as
                  | {
                      policyId?: string;
                    }
                  | undefined
              )?.policyId,
            ).toBe(expected?.policyId);
          }
        },
      ),
      {
        numRuns: 300,
      },
    );
  });

  it("a matching deny always wins, wherever it sits in the list", () => {
    fc.assert(
      fc.property(
        policiesArb,
        inputArb,
        fc.nat(),
        (policies, input, position) => {
          const deny: AbacPolicy = {
            effect: "deny",
            id: "always-deny",
          };
          const at = position % (policies.length + 1);
          const withDeny = [
            ...policies.slice(0, at),
            deny,
            ...policies.slice(at),
          ];
          expect(
            createAbacEvaluator({
              policies: withDeny,
            })(input)?.effect,
          ).toBe("deny");
        },
      ),
    );
  });

  it("through the engine, arbitrary input always ends in allow or deny and never throws", () => {
    fc.assert(
      fc.property(policiesArb, fc.anything(), (policies, input) => {
        const engine = createEngine({
          evaluators: [
            createAbacEvaluator({
              policies,
            }),
          ],
        });
        expect([
          "allow",
          "deny",
        ]).toContain(engine.evaluate(input as never).effect);
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("called directly with a malformed input, it decides, abstains, or throws a TypeError (the engine catches it)", () => {
    fc.assert(
      fc.property(policiesArb, fc.anything(), (policies, input) => {
        const evaluator = createAbacEvaluator({
          policies,
        });
        try {
          const decision = evaluator(input as never);
          expect([
            undefined,
            "allow",
            "deny",
          ]).toContain(decision?.effect);
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
        }
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("arbitrary JSON as a condition either compiles or throws InvalidPolicyError, never anything else", () => {
    fc.assert(
      fc.property(fc.anything(), (condition) => {
        try {
          createAbacEvaluator({
            policies: [
              {
                conditions: [
                  condition as never,
                ],
                effect: "allow",
                id: "p",
              },
            ],
          });
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidPolicyError);
        }
      }),
      {
        numRuns: 500,
      },
    );
  });
});
