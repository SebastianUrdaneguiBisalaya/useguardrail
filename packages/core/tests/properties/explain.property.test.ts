import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Evaluator } from "../../src/index.js";
import { createEngine } from "../../src/index.js";

type Behavior = "allow" | "deny" | "abstain" | "throw" | "malformed";

const evaluatorFor = (behavior: Behavior): Evaluator => {
  switch (behavior) {
    case "allow":
      return () => ({
        effect: "allow",
        reason: "allowed",
      });
    case "deny":
      return () => ({
        effect: "deny",
        reason: "denied",
      });
    case "abstain":
      return () => undefined;
    case "throw":
      return () => {
        throw new Error("boom");
      };
    case "malformed":
      return (() => ({
        effect: "maybe",
        reason: 1,
      })) as unknown as Evaluator;
  }
};

const behaviors = fc.array(
  fc.constantFrom<Behavior>("allow", "deny", "abstain", "throw", "malformed"),
  {
    maxLength: 8,
  },
);

const request = {
  action: "read",
  context: {},
  resource: {
    type: "doc",
  },
  subject: {
    id: "u",
  },
};

const OUTCOME: Record<Behavior, string> = {
  abstain: "abstain",
  allow: "allow",
  deny: "deny",
  malformed: "malformed",
  throw: "threw",
};

describe("explain properties", () => {
  it("explain and evaluate always agree, with and without a hook", () => {
    fc.assert(
      fc.property(behaviors, (list) => {
        const plain = createEngine({
          evaluators: list.map(evaluatorFor),
        });
        const hooked = createEngine({
          evaluators: list.map(evaluatorFor),
          onDecision: () => undefined,
        });
        const expected = plain.evaluate(request);
        expect(plain.explain(request).decision).toEqual(expected);
        expect(hooked.evaluate(request)).toEqual(expected);
        expect(hooked.explain(request).decision).toEqual(expected);
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("the trace lists exactly the evaluators consulted, up to the first blocking one", () => {
    fc.assert(
      fc.property(behaviors, (list) => {
        const { trace } = createEngine({
          evaluators: list.map(evaluatorFor),
        }).explain(request);

        const stop = list.findIndex(
          (b) => b === "deny" || b === "throw" || b === "malformed",
        );
        const consulted = stop === -1 ? list : list.slice(0, stop + 1);

        expect(trace.map((entry) => entry.index)).toEqual(
          consulted.map((_, i) => i),
        );
        expect(trace.map((entry) => entry.outcome)).toEqual(
          consulted.map((b) => OUTCOME[b]),
        );
      }),
      {
        numRuns: 300,
      },
    );
  });
});
