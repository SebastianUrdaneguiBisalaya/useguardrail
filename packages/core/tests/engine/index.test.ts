import { describe, expect, it, vi } from "vitest";
import type { Decision, EvaluationInput, Evaluator } from "../../src/index.js";
import { createEngine, InvalidPolicyError } from "../../src/index.js";

const input: EvaluationInput = {
  action: "read",
  context: {
    tenantId: "t1",
  },
  resource: {
    type: "doc",
  },
  subject: {
    id: "u1",
  },
};

const allow: Evaluator = () => ({
  effect: "allow",
  reason: "granted",
});
const deny: Evaluator = () => ({
  effect: "deny",
  reason: "forbidden",
});
const abstain: Evaluator = () => undefined;

describe("createEngine", () => {
  it("allows when an evaluator allows and none deny", () => {
    const engine = createEngine({
      evaluators: [
        abstain,
        allow,
      ],
    });
    expect(engine.evaluate(input)).toEqual({
      effect: "allow",
      reason: "granted",
    });
  });

  it("denies by default when no evaluator has an opinion", () => {
    expect(
      createEngine({
        evaluators: [
          abstain,
        ],
      }).evaluate(input).effect,
    ).toBe("deny");
    expect(
      createEngine({
        evaluators: [],
      }).evaluate(input).effect,
    ).toBe("deny");
  });

  it("deny overrides allow regardless of order", () => {
    expect(
      createEngine({
        evaluators: [
          allow,
          deny,
        ],
      }).evaluate(input),
    ).toEqual({
      effect: "deny",
      reason: "forbidden",
    });
    expect(
      createEngine({
        evaluators: [
          deny,
          allow,
        ],
      }).evaluate(input).effect,
    ).toBe("deny");
  });

  it("fails closed when an evaluator throws", () => {
    const boom: Evaluator = () => {
      throw new Error("secret detail");
    };
    const decision = createEngine({
      evaluators: [
        allow,
        boom,
      ],
    }).evaluate(input);
    expect(decision.effect).toBe("deny");
    expect(decision.reason).not.toContain("secret detail");
  });

  it("fails closed on a malformed decision", () => {
    const bad = (() => ({
      effect: "maybe",
      reason: "x",
    })) as unknown as Evaluator;
    expect(
      createEngine({
        evaluators: [
          allow,
          bad,
        ],
      }).evaluate(input).effect,
    ).toBe("deny");
  });

  it("is deterministic and passes the input through untouched", () => {
    const spy = vi.fn<(i: EvaluationInput) => Decision>(() => ({
      effect: "allow",
      reason: "ok",
    }));
    const engine = createEngine({
      evaluators: [
        spy,
      ],
    });
    expect(engine.evaluate(input)).toEqual(engine.evaluate(input));
    expect(spy).toHaveBeenCalledWith(input);
  });

  it("is not affected by mutating the evaluators array after creation", () => {
    const evaluators: Evaluator[] = [
      abstain,
    ];
    const engine = createEngine({
      evaluators,
    });
    evaluators.push(allow);
    expect(engine.evaluate(input).effect).toBe("deny");
  });

  it("rejects invalid configuration", () => {
    expect(() =>
      createEngine({
        evaluators: "nope",
      } as never),
    ).toThrow(InvalidPolicyError);
    expect(() =>
      createEngine({
        evaluators: [
          1,
        ],
      } as never),
    ).toThrow(InvalidPolicyError);
    expect(() => createEngine(undefined as never)).toThrow(InvalidPolicyError);
  });
});
