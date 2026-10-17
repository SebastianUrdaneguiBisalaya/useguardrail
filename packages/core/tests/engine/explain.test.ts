import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionEvent,
  EvaluationInput,
  Evaluator,
} from "../../src/index.js";
import { createEngine, InvalidPolicyError } from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    id: "u1",
  },
};

const allow: Evaluator = () => ({
  code: "A",
  effect: "allow",
  params: {
    n: 1,
  },
  reason: "allowed",
});
const deny: Evaluator = () => ({
  effect: "deny",
  reason: "denied",
});
const abstain: Evaluator = () => undefined;

describe("engine.explain", () => {
  it("returns the decision plus what each evaluator answered", () => {
    const engine = createEngine({
      evaluators: [
        abstain,
        allow,
      ],
    });
    const event = engine.explain(input);

    expect(event.input).toBe(input);
    expect(event.decision).toEqual({
      code: "A",
      effect: "allow",
      params: {
        n: 1,
      },
      reason: "allowed",
    });
    expect(event.trace).toEqual([
      {
        index: 0,
        outcome: "abstain",
      },
      {
        decision: event.decision,
        index: 1,
        outcome: "allow",
      },
    ]);
  });

  it("agrees with evaluate", () => {
    const engine = createEngine({
      evaluators: [
        abstain,
        allow,
        deny,
      ],
    });
    expect(engine.explain(input).decision).toEqual(engine.evaluate(input));
  });

  it("records a deny and stops there", () => {
    const never = vi.fn(() => undefined);
    const engine = createEngine({
      evaluators: [
        allow,
        deny,
        never,
      ],
    });
    const { decision, trace } = engine.explain(input);
    expect(decision.effect).toBe("deny");
    expect(trace.map((entry) => entry.outcome)).toEqual([
      "allow",
      "deny",
    ]);
    expect(never).not.toHaveBeenCalled();
  });

  it("records a throwing evaluator with its error, without exposing it in the decision", () => {
    const boom = new Error("secret detail");
    const engine = createEngine({
      evaluators: [
        () => {
          throw boom;
        },
      ],
    });
    const { decision, trace } = engine.explain(input);
    expect(decision.code).toBe("EVALUATOR_FAILED");
    expect(JSON.stringify(decision)).not.toContain("secret detail");
    expect(trace).toEqual([
      {
        error: boom,
        index: 0,
        outcome: "threw",
      },
    ]);
  });

  it("records a malformed decision", () => {
    const bad = (() => ({
      effect: "maybe",
      reason: 1,
    })) as unknown as Evaluator;
    const { decision, trace } = createEngine({
      evaluators: [
        bad,
      ],
    }).explain(input);
    expect(decision.code).toBe("EVALUATOR_MALFORMED");
    expect(trace).toEqual([
      {
        index: 0,
        outcome: "malformed",
      },
    ]);
  });

  it("explains a default deny with every evaluator abstaining", () => {
    const { decision, trace } = createEngine({
      evaluators: [
        abstain,
        abstain,
      ],
    }).explain(input);
    expect(decision.code).toBe("DEFAULT_DENY");
    expect(trace.map((entry) => entry.outcome)).toEqual([
      "abstain",
      "abstain",
    ]);
  });

  it("freezes the event and its trace", () => {
    const event = createEngine({
      evaluators: [
        allow,
      ],
    }).explain(input);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.trace)).toBe(true);
  });
});

describe("engine onDecision", () => {
  it("is called once per evaluation with the input, decision, and trace", () => {
    const events: DecisionEvent[] = [];
    const engine = createEngine({
      evaluators: [
        abstain,
        allow,
      ],
      onDecision: (event) => events.push(event),
    });
    const decision = engine.evaluate(input);

    expect(events).toHaveLength(1);
    expect(events[0]?.input).toBe(input);
    expect(events[0]?.decision).toEqual(decision);
    expect(events[0]?.trace.map((entry) => entry.outcome)).toEqual([
      "abstain",
      "allow",
    ]);
  });

  it("is also called by explain, once", () => {
    const onDecision = vi.fn();
    const engine = createEngine({
      evaluators: [
        allow,
      ],
      onDecision,
    });
    engine.explain(input);
    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it("does not change the decision", () => {
    const plain = createEngine({
      evaluators: [
        abstain,
        allow,
      ],
    });
    const hooked = createEngine({
      evaluators: [
        abstain,
        allow,
      ],
      onDecision: () => undefined,
    });
    expect(hooked.evaluate(input)).toEqual(plain.evaluate(input));
  });

  it("cannot break evaluation: a throwing hook is rethrown asynchronously", () => {
    const rethrown: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        rethrown.push(error);
      }
    });
    const boom = new Error("hook failed");
    const engine = createEngine({
      evaluators: [
        allow,
      ],
      onDecision: () => {
        throw boom;
      },
    });
    expect(engine.evaluate(input).effect).toBe("allow");
    expect(rethrown).toEqual([
      boom,
    ]);
  });

  it("does not leak a mutable event: hooks cannot alter the trace", () => {
    const engine = createEngine({
      evaluators: [
        allow,
      ],
      onDecision: (event) => {
        expect(() => {
          (event.trace as unknown[]).push({});
        }).toThrow(TypeError);
      },
    });
    expect(engine.evaluate(input).effect).toBe("allow");
  });

  it("rejects a hook that is not a function", () => {
    expect(() =>
      createEngine({
        evaluators: [],
        onDecision: "log" as never,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ON_DECISION_INVALID",
      }),
    );
    expect(() =>
      createEngine({
        evaluators: [],
        onDecision: 5 as never,
      }),
    ).toThrow(InvalidPolicyError);
  });
});
