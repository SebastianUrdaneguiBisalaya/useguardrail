import { InvalidPolicyError } from "../errors.js";
import { rethrowAsync } from "../report.js";
import type {
  Decision,
  DecisionCode,
  EvaluationInput,
  Evaluator,
  Schema,
} from "../types/index.js";

/** What one evaluator answered during an evaluation. */
export type EvaluatorOutcome =
  | "allow"
  | "deny"
  | "abstain"
  | "threw"
  | "malformed";

/** One evaluator's contribution to a decision. */
export type EvaluatorTrace = {
  /** Position of the evaluator in `config.evaluators`. */
  readonly index: number;
  readonly outcome: EvaluatorOutcome;
  /** The decision it returned, for `"allow"` and `"deny"`. */
  readonly decision?: Decision;
  /** What it threw, for `"threw"`. Never part of the decision returned to callers. */
  readonly error?: unknown;
};

/**
 * Everything about one evaluation: the request, the final decision, and what each consulted
 * evaluator answered. Meant for debugging and auditing; treat it as read-only.
 *
 * Evaluation stops at the first evaluator that denies, throws, or misbehaves, so evaluators
 * after it do not appear in `trace`.
 */
export type DecisionEvent<S extends Schema = Schema> = {
  readonly input: EvaluationInput<S>;
  readonly decision: Decision;
  readonly trace: readonly EvaluatorTrace[];
};

/** Configuration for {@link createEngine}. */
export type EngineConfig<S extends Schema = Schema> = {
  /** Authorization models (RBAC, ReBAC, ABAC...) consulted on every evaluation. */
  readonly evaluators: readonly (Evaluator<S> | Evaluator)[];
  /**
   * Called after every evaluation with the request, the decision, and a per-evaluator trace.
   * Use it for debugging and auditing; the library itself never logs.
   *
   * It runs synchronously and cannot change the decision. If it throws, the error is
   * rethrown asynchronously (it shows up as an unhandled error) and the decision is
   * unaffected. The event contains the full request (subject and resource attributes), so
   * redact it before sending it anywhere. With no hook, no trace is built.
   */
  readonly onDecision?: (event: DecisionEvent<S>) => void;
};

/** A framework-independent authorization engine. */
export type Engine<S extends Schema = Schema> = {
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
  readonly evaluate: (input: EvaluationInput<S>) => Decision;
  /**
   * Like `evaluate`, but returns the whole {@link DecisionEvent}: the decision plus what each
   * consulted evaluator answered. Use it to find out why something was denied. It reports to
   * `onDecision` exactly like `evaluate` does. Never throws.
   *
   * @example
   * const { decision, trace } = engine.explain({ subject, action: "update", resource, context });
   */
  readonly explain: (input: EvaluationInput<S>) => DecisionEvent<S>;
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
 * @throws {InvalidPolicyError} If `config.evaluators` is not an array of functions, or
 * `config.onDecision` is not a function.
 *
 * @example
 * const engine = createEngine({
 *   evaluators: [rbacEvaluator, abacEvaluator],
 *   onDecision: ({ input, decision }) => audit.record(input.action, decision.code),
 * });
 */
export function createEngine<S extends Schema = Schema>(
  config: EngineConfig<S>,
): Engine<S> {
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
  const onDecision: unknown = config.onDecision;
  if (onDecision !== undefined && typeof onDecision !== "function") {
    throw new InvalidPolicyError(
      "Engine config requires `onDecision` to be a function.",
      {
        code: "ON_DECISION_INVALID",
      },
    );
  }
  const hook = onDecision as ((event: DecisionEvent<S>) => void) | undefined;
  const registered: readonly Evaluator<S>[] = Object.freeze([
    ...(evaluators as Evaluator<S>[]),
  ]);

  const run = (
    input: EvaluationInput<S>,
    withTrace: boolean,
  ): {
    decision: Decision;
    trace: EvaluatorTrace[];
  } => {
    const trace: EvaluatorTrace[] = [];
    let allowed: Decision | undefined;

    for (const [index, evaluator] of registered.entries()) {
      let result: Decision | undefined;
      try {
        result = evaluator(input);
      } catch (error) {
        if (withTrace) {
          trace.push({
            error,
            index,
            outcome: "threw",
          });
        }
        return {
          decision: deny(
            "An evaluator failed; access denied.",
            "EVALUATOR_FAILED",
          ),
          trace,
        };
      }

      if (result === undefined) {
        if (withTrace) {
          trace.push({
            index,
            outcome: "abstain",
          });
        }
        continue;
      }
      if (!isDecision(result)) {
        if (withTrace) {
          trace.push({
            index,
            outcome: "malformed",
          });
        }
        return {
          decision: deny(
            "An evaluator returned a malformed decision; access denied.",
            "EVALUATOR_MALFORMED",
          ),
          trace,
        };
      }
      if (result.effect === "deny") {
        const decision = passThrough(result);
        if (withTrace) {
          trace.push({
            decision,
            index,
            outcome: "deny",
          });
        }
        return {
          decision,
          trace,
        };
      }
      if (allowed === undefined || withTrace) {
        const decision = passThrough(result);
        if (withTrace) {
          trace.push({
            decision,
            index,
            outcome: "allow",
          });
        }
        allowed ??= decision;
      }
    }

    return {
      decision:
        allowed ??
        deny("No evaluator granted access (default deny).", "DEFAULT_DENY"),
      trace,
    };
  };

  const explain = (input: EvaluationInput<S>): DecisionEvent<S> => {
    const { decision, trace } = run(input, true);
    const event: DecisionEvent<S> = Object.freeze({
      decision,
      input,
      trace: Object.freeze(trace),
    });
    if (hook !== undefined) {
      try {
        hook(event);
      } catch (error) {
        rethrowAsync(error);
      }
    }
    return event;
  };

  const evaluate = (input: EvaluationInput<S>): Decision =>
    hook === undefined ? run(input, false).decision : explain(input).decision;

  return Object.freeze({
    evaluate,
    explain,
  });
}
