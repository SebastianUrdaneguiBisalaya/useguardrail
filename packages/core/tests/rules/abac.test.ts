import { describe, expect, it } from "vitest";
import type { AbacPolicy, EvaluationInput } from "../../src/index.js";
import {
  createAbacEvaluator,
  createEngine,
  InvalidPolicyError,
} from "../../src/index.js";

const input = (overrides: Partial<EvaluationInput> = {}): EvaluationInput => ({
  action: "read",
  context: {
    attributes: {
      hour: 10,
    },
    tenantId: "t1",
  },
  resource: {
    attributes: {
      department: "sales",
      status: "open",
      tags: [
        "a",
        "b",
      ],
    },
    type: "invoice",
  },
  subject: {
    attributes: {
      age: 30,
      department: "sales",
    },
    id: "u1",
  },
  ...overrides,
});

const evaluator = (...policies: AbacPolicy[]) =>
  createAbacEvaluator({
    policies,
  });

describe("createAbacEvaluator", () => {
  it("applies a policy with no conditions to matching action and resource", () => {
    const e = evaluator({
      actions: [
        "read",
      ],
      effect: "allow",
      id: "p",
      resources: [
        "invoice",
      ],
    });
    expect(e(input())?.effect).toBe("allow");
    expect(
      e(
        input({
          action: "delete",
        }),
      ),
    ).toBeUndefined();
    expect(
      e(
        input({
          resource: {
            type: "user",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('treats omitted scopes and "*" as match-all', () => {
    expect(
      evaluator({
        effect: "allow",
        id: "p",
      })(input())?.effect,
    ).toBe("allow");
    expect(
      evaluator({
        actions: [
          "*",
        ],
        effect: "allow",
        id: "p",
      })(input())?.effect,
    ).toBe("allow");
  });

  it("compares a field against a literal and against another field", () => {
    const literal = evaluator({
      conditions: [
        {
          field: "resource.attributes.status",
          op: "eq",
          value: "open",
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(literal(input())?.effect).toBe("allow");

    const sameDept = evaluator({
      conditions: [
        {
          field: "subject.attributes.department",
          op: "eq",
          valueFrom: "resource.attributes.department",
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(sameDept(input())?.effect).toBe("allow");
    expect(
      sameDept(
        input({
          subject: {
            attributes: {
              department: "hr",
            },
            id: "u1",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("requires every condition (AND)", () => {
    const e = evaluator({
      conditions: [
        {
          field: "resource.attributes.status",
          op: "eq",
          value: "open",
        },
        {
          field: "subject.attributes.age",
          op: "gte",
          value: 31,
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(e(input())).toBeUndefined();
  });

  it.each([
    [
      "neq",
      "resource.attributes.status",
      "closed",
      true,
    ],
    [
      "in",
      "resource.attributes.status",
      [
        "open",
        "draft",
      ],
      true,
    ],
    [
      "nin",
      "resource.attributes.status",
      [
        "open",
      ],
      false,
    ],
    [
      "gt",
      "subject.attributes.age",
      29,
      true,
    ],
    [
      "lt",
      "subject.attributes.age",
      30,
      false,
    ],
    [
      "lte",
      "subject.attributes.age",
      30,
      true,
    ],
    [
      "contains",
      "resource.attributes.tags",
      "a",
      true,
    ],
    [
      "contains",
      "resource.attributes.status",
      "pe",
      true,
    ],
    [
      "gt",
      "subject.attributes.age",
      "29",
      false,
    ],
  ] as const)(
    "operator %s on %s with %j -> %s",
    (op, field, value, expected) => {
      const e = evaluator({
        conditions: [
          {
            field,
            op,
            value,
          },
        ],
        effect: "allow",
        id: "p",
      });
      expect(e(input()) !== undefined).toBe(expected);
    },
  );

  it("supports exists true and false", () => {
    const has = evaluator({
      conditions: [
        {
          field: "resource.attributes.status",
          op: "exists",
          value: true,
        },
      ],
      effect: "allow",
      id: "p",
    });
    const lacks = evaluator({
      conditions: [
        {
          field: "resource.attributes.nope",
          op: "exists",
          value: false,
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(has(input())?.effect).toBe("allow");
    expect(lacks(input())?.effect).toBe("allow");
  });

  it("does not hold when a field is missing", () => {
    const e = evaluator({
      conditions: [
        {
          field: "subject.attributes.missing",
          op: "neq",
          value: "x",
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(e(input())).toBeUndefined();
  });

  it("default-denies through the engine when no policy matches", () => {
    const e = evaluator({
      actions: [
        "delete",
      ],
      effect: "allow",
      id: "only-delete",
    });
    expect(e(input())).toBeUndefined();
    expect(
      createEngine({
        evaluators: [
          e,
        ],
      }).evaluate(input()).effect,
    ).toBe("deny");
  });

  it("deny wins over allow within the evaluator, and via the engine", () => {
    const e = evaluator(
      {
        effect: "allow",
        id: "allow-all",
      },
      {
        conditions: [
          {
            field: "resource.attributes.status",
            op: "eq",
            value: "open",
          },
        ],
        effect: "deny",
        id: "no-open",
      },
    );
    expect(e(input())).toMatchObject({
      effect: "deny",
      reason: 'Policy "no-open" denies access.',
    });
    expect(
      createEngine({
        evaluators: [
          e,
        ],
      }).evaluate(input()).effect,
    ).toBe("deny");
  });

  it("cannot read inherited properties via the prototype chain", () => {
    const e = evaluator({
      conditions: [
        {
          field: "subject.attributes.toString",
          op: "exists",
          value: true,
        },
      ],
      effect: "allow",
      id: "p",
    });
    expect(e(input())).toBeUndefined();
  });

  it("scopes policies by action and resource type, keeping declaration order", () => {
    const e = evaluator(
      {
        effect: "allow",
        id: "first-any",
      },
      {
        actions: [
          "read",
        ],
        effect: "allow",
        id: "read-only",
        resources: [
          "invoice",
        ],
      },
      {
        actions: [
          "delete",
        ],
        effect: "deny",
        id: "delete-deny",
        resources: [
          "invoice",
        ],
      },
      {
        effect: "deny",
        id: "other-type",
        resources: [
          "user",
        ],
      },
    );
    expect(e(input())).toMatchObject({
      effect: "allow",
      reason: 'Policy "first-any" allows access.',
    });
    expect(
      e(
        input({
          action: "delete",
        }),
      ),
    ).toMatchObject({
      effect: "deny",
      reason: 'Policy "delete-deny" denies access.',
    });
    expect(
      e(
        input({
          resource: {
            type: "user",
          },
        }),
      )?.effect,
    ).toBe("deny");
  });

  it("stays correct past the internal scope-cache limit", () => {
    const e = evaluator({
      actions: [
        "read",
      ],
      effect: "allow",
      id: "read-invoice",
      resources: [
        "invoice",
      ],
    });
    for (let i = 0; i < 3_000; i += 1) {
      expect(
        e(
          input({
            action: `noise-${i}`,
          }),
        ),
      ).toBeUndefined();
    }
    expect(e(input())?.effect).toBe("allow");
  });

  it("rejects malformed policies", () => {
    const bad = (policies: unknown) => () =>
      createAbacEvaluator({
        policies,
      } as never);
    const cond = (c: unknown) =>
      bad([
        {
          conditions: [
            c,
          ],
          effect: "allow",
          id: "p",
        },
      ]);
    expect(bad(undefined)).toThrow(InvalidPolicyError);
    expect(
      bad([
        null,
      ]),
    ).toThrow(InvalidPolicyError);
    expect(
      bad([
        {
          effect: "allow",
        },
      ]),
    ).toThrow(InvalidPolicyError);
    expect(
      bad([
        {
          effect: "maybe",
          id: "p",
        },
      ]),
    ).toThrow(InvalidPolicyError);
    expect(
      bad([
        {
          effect: "allow",
          id: "p",
        },
        {
          effect: "deny",
          id: "p",
        },
      ]),
    ).toThrow(/Duplicate/);
    expect(
      bad([
        {
          actions: "read",
          effect: "allow",
          id: "p",
        },
      ]),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.x",
        op: "regex",
        value: "x",
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "other.x",
        op: "eq",
        value: 1,
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.__proto__.x",
        op: "eq",
        value: 1,
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject..x",
        op: "eq",
        value: 1,
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.x",
        op: "eq",
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.x",
        op: "eq",
        value: 1,
        valueFrom: "subject.y",
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.x",
        op: "in",
        value: "notarray",
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      cond({
        field: "subject.x",
        op: "exists",
        value: "yes",
      }),
    ).toThrow(InvalidPolicyError);
  });
});
