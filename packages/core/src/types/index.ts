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

/** The result of evaluating an access request. */
export type Decision = {
  readonly effect: DecisionEffect;
  /** Human-readable explanation of why this decision was reached. */
  readonly reason: string;
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
