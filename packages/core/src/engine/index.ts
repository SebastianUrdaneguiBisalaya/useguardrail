import { InvalidPolicyError } from "../errors.js";
import type { Decision, EvaluationInput, Evaluator } from "../types/index.js";

/** Configuration for {@link createEngine}. */
export type EngineConfig = {
  /** Authorization models (RBAC, ReBAC, ABAC...) consulted on every evaluation. */
  readonly evaluators: readonly Evaluator[];
};

/** A framework-independent authorization engine. */
export type Engine = {
  /**
   * Evaluates an access request against every configured evaluator.
   *
   * Deny overrides allow; with no opinion from any evaluator the result is deny.
   * An evaluator that throws or returns a malformed decision also results in deny.
   * Never throws.
   *
   * @example
   * const decision = engine.evaluate({ subject, action: "read", resource, context });
   * if (decision.effect === "allow") { ... }
   */
  readonly evaluate: (input: EvaluationInput) => Decision;
};

const deny = (reason: string): Decision =>
  Object.freeze({
    effect: "deny",
    reason,
  });

const isDecision = (value: unknown): value is Decision => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    effect?: unknown;
    reason?: unknown;
  };
  return (
    (candidate.effect === "allow" || candidate.effect === "deny") &&
    typeof candidate.reason === "string"
  );
};

/**
 * Creates an authorization engine from a set of pluggable evaluators.
 *
 * @throws {InvalidPolicyError} If `config.evaluators` is not an array of functions.
 *
 * @example
 * const engine = createEngine({ evaluators: [rbacEvaluator, abacEvaluator] });
 */
export function createEngine(config: EngineConfig): Engine {
  const evaluators: unknown = config?.evaluators;
  if (
    !Array.isArray(evaluators) ||
    evaluators.some((item) => typeof item !== "function")
  ) {
    throw new InvalidPolicyError(
      "Engine config requires `evaluators` to be an array of functions.",
    );
  }
  const registered: readonly Evaluator[] = Object.freeze([
    ...(evaluators as Evaluator[]),
  ]);

  const evaluate = (input: EvaluationInput): Decision => {
    let allowed: Decision | undefined;

    for (const evaluator of registered) {
      let result: Decision | undefined;
      try {
        result = evaluator(input);
      } catch {
        return deny("An evaluator failed; access denied.");
      }

      if (result === undefined) {
        continue;
      }
      if (!isDecision(result)) {
        return deny(
          "An evaluator returned a malformed decision; access denied.",
        );
      }
      if (result.effect === "deny") {
        return Object.freeze({
          effect: "deny",
          reason: result.reason,
        });
      }
      allowed ??= result;
    }

    if (allowed) {
      return Object.freeze({
        effect: "allow",
        reason: allowed.reason,
      });
    }
    return deny("No evaluator granted access (default deny).");
  };

  return Object.freeze({
    evaluate,
  });
}
