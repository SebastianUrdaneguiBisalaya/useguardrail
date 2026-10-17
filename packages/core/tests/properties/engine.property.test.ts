import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Evaluator } from "../../src/index.js";
import {
  createAbacEvaluator,
  createAuthorizationStore,
  createContext,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  InvalidContextError,
} from "../../src/index.js";

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
  context: {
    tenantId: "t",
  },
  resource: {
    id: "1",
    type: "doc",
  },
  subject: {
    id: "u",
  },
};

describe("engine properties", () => {
  it("allows exactly when something allows and nothing denies, throws, or misbehaves", () => {
    fc.assert(
      fc.property(behaviors, (list) => {
        const engine = createEngine({
          evaluators: list.map(evaluatorFor),
        });
        const blocked = list.some(
          (b) => b === "deny" || b === "throw" || b === "malformed",
        );
        const expected = !blocked && list.includes("allow") ? "allow" : "deny";
        expect(engine.evaluate(request).effect).toBe(expected);
      }),
    );
  });

  it("is deterministic and independent of evaluator order for the effect", () => {
    fc.assert(
      fc.property(behaviors, (list) => {
        const forward = createEngine({
          evaluators: list.map(evaluatorFor),
        });
        const backward = createEngine({
          evaluators: [
            ...list,
          ]
            .reverse()
            .map(evaluatorFor),
        });
        expect(forward.evaluate(request)).toEqual(forward.evaluate(request));
        expect(forward.evaluate(request).effect).toBe(
          backward.evaluate(request).effect,
        );
      }),
    );
  });

  it("never throws and always returns a well-formed decision, whatever the input", () => {
    const engine = createEngine({
      evaluators: [
        createRbacEvaluator({
          roles: {
            a: {
              permissions: [
                "*",
              ],
            },
          },
        }),
        createAbacEvaluator({
          policies: [
            {
              conditions: [
                {
                  field: "subject.id",
                  op: "eq",
                  value: "u",
                },
              ],
              effect: "allow",
              id: "p",
            },
          ],
        }),
        createRebacEvaluator({
          graph: createRelationGraph({
            tuples: [],
          }),
          requirements: {
            doc: {
              read: "viewer",
            },
          },
        }),
      ],
    });
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const decision = engine.evaluate(input as never);
        expect([
          "allow",
          "deny",
        ]).toContain(decision.effect);
        expect(typeof decision.reason).toBe("string");
      }),
      {
        numRuns: 300,
      },
    );
  });
});

describe("context and store properties", () => {
  it("createContext either returns a frozen context or throws InvalidContextError", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        try {
          const context = createContext(input as never);
          expect(Object.isFrozen(context)).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidContextError);
        }
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("store.evaluate never throws and denies when the subject or status blocks it", () => {
    const engine = createEngine({
      evaluators: [
        evaluatorFor("allow"),
      ],
    });
    fc.assert(
      fc.property(
        fc.anything(),
        fc.anything(),
        fc.constantFrom("ready", "loading", "error"),
        (action, resource, status) => {
          const store = createAuthorizationStore({
            engine,
            status: "ready",
            subject: {
              id: "u",
            },
          });
          if (status === "loading") store.setStatus("loading");
          if (status === "error") store.setError(new Error("x"));

          const decision = store.evaluate(action as never, resource as never);
          expect([
            "allow",
            "deny",
          ]).toContain(decision.effect);
          if (status !== "ready") {
            expect(decision.effect).toBe("deny");
          }
        },
      ),
      {
        numRuns: 200,
      },
    );
  });
});
