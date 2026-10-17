/** Free-form attributes attached to a subject, resource, or context. */
export type Attributes = Readonly<Record<string, unknown>>;

/** The operation being attempted, e.g. `"read"` or `"invoice:update"`. */
export type Action = string;

/** The actor requesting access. */
export type Subject = {
  readonly id: string;
  /** Roles assigned to the subject (used by RBAC evaluators). */
  readonly roles?: readonly string[];
  /** Arbitrary attributes (used by ABAC evaluators). */
  readonly attributes?: Attributes;
};

/** The target of the action. */
export type Resource = {
  readonly type: string;
  readonly id?: string;
  readonly attributes?: Attributes;
};

/** Ambient information for a decision. Tenancy is always explicit here, never module state. */
export type Context = {
  readonly tenantId?: string;
  readonly attributes?: Attributes;
};

/** Outcome of an evaluation. */
export type DecisionEffect = "allow" | "deny";

/**
 * Language-neutral values that explain an error or a decision (positions, role names,
 * policy ids, paths). Serializable, and safe to pass to an i18n library.
 */
export type MessageParams = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;

/**
 * Every stable decision `code` produced by the built-in evaluators and the engine.
 * Custom evaluators may use their own codes.
 */
export const DECISION_CODES = [
  "ROLE_GRANTS",
  "POLICY_ALLOWS",
  "POLICY_DENIES",
  "RELATION_GRANTS",
  "DEFAULT_DENY",
  "EVALUATOR_FAILED",
  "EVALUATOR_MALFORMED",
  "NO_SUBJECT",
  "LOADING",
  "LOAD_FAILED",
] as const;

/** A built-in decision code. See {@link DECISION_CODES}. */
export type DecisionCode = (typeof DECISION_CODES)[number];

/** The result of evaluating an access request. */
export type Decision = {
  readonly effect: DecisionEffect;
  /** English explanation of why this decision was reached. Use `code` + `params` to localize. */
  readonly reason: string;
  /**
   * Stable identifier for the reason (a {@link DecisionCode} for built-ins). Optional so
   * custom evaluators are not forced to provide one.
   */
  readonly code?: string;
  /** Values that fill in a translated message for `code`. */
  readonly params?: MessageParams;
};

/** Everything an evaluator needs to decide on a single access request. */
export type EvaluationInput = {
  readonly subject: Subject;
  readonly action: Action;
  readonly resource: Resource;
  readonly context: Context;
};

/**
 * A pluggable authorization model (RBAC, ReBAC, ABAC...).
 * Returns a {@link Decision}, or `undefined` when it has no opinion.
 */
export type Evaluator = (input: EvaluationInput) => Decision | undefined;
