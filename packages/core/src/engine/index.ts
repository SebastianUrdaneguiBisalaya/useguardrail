import { InvalidPolicyError } from "../errors.js";
import type {
  Decision,
  DecisionCode,
  EvaluationInput,
  Evaluator,
} from "../types/index.js";

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

const deny = (reason: string, code: DecisionCode): Decision =>
  Object.freeze({
    code,
    effect: "deny",
    reason,
  });

const passThrough = (decision: Decision): Decision =>
  Object.freeze({
    effect: decision.effect,
    reason: decision.reason,
    ...(decision.code === undefined
      ? {}
      : {
          code: decision.code,
        }),
    ...(decision.params === undefined
      ? {}
      : {
          params: Object.freeze({
            ...decision.params,
          }),
        }),
  });

const isDecision = (value: unknown): value is Decision => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    code?: unknown;
    effect?: unknown;
    params?: unknown;
    reason?: unknown;
  };
  return (
    (candidate.effect === "allow" || candidate.effect === "deny") &&
    typeof candidate.reason === "string" &&
    (candidate.code === undefined || typeof candidate.code === "string") &&
    (candidate.params === undefined ||
      (typeof candidate.params === "object" && candidate.params !== null))
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
      {
        code: "EVALUATORS_INVALID",
      },
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
        return deny("An evaluator failed; access denied.", "EVALUATOR_FAILED");
      }

      if (result === undefined) {
        continue;
      }
      if (!isDecision(result)) {
        return deny(
          "An evaluator returned a malformed decision; access denied.",
          "EVALUATOR_MALFORMED",
        );
      }
      if (result.effect === "deny") {
        return passThrough(result);
      }
      allowed ??= result;
    }

    if (allowed) {
      return passThrough(allowed);
    }
    return deny("No evaluator granted access (default deny).", "DEFAULT_DENY");
  };

  return Object.freeze({
    evaluate,
  });
}
