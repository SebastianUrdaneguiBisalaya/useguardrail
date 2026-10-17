import { InvalidPolicyError } from "../errors.js";
import type { EvaluationInput, Evaluator } from "../types/index.js";
import { parsePath, readPath } from "./path.js";

/** Comparison operators available in an ABAC {@link Condition}. */
export type ConditionOperator =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists";

/**
 * A single check against the evaluation input.
 *
 * `field` is a dot path starting at `subject`, `action`, `resource` or `context`
 * (e.g. `"subject.attributes.department"`). Compare it with a literal `value`, or with
 * another field through `valueFrom`. `exists` takes a boolean `value`.
 * If either side is missing, the condition does not hold.
 */
export type Condition = {
  readonly field: string;
  readonly op: ConditionOperator;
  readonly value?: unknown;
  readonly valueFrom?: string;
};

/** An attribute-based policy. All `conditions` must hold (AND) for the policy to apply. */
export type AbacPolicy = {
  /** Unique identifier, used in decision reasons. */
  readonly id: string;
  readonly effect: "allow" | "deny";
  /** Actions this policy applies to. Omit (or use `"*"`) for any action. */
  readonly actions?: readonly string[];
  /** Resource types this policy applies to. Omit (or use `"*"`) for any type. */
  readonly resources?: readonly string[];
  readonly conditions?: readonly Condition[];
};

/** Configuration for {@link createAbacEvaluator}. */
export type AbacConfig = {
  readonly policies: readonly AbacPolicy[];
};

const OPERATORS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "in",
  "nin",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
]);
const ROOTS: ReadonlySet<string> = new Set([
  "subject",
  "action",
  "resource",
  "context",
]);

const compare = (
  op: ConditionOperator,
  left: unknown,
  right: unknown,
): boolean => {
  if (left === undefined || right === undefined) {
    return false;
  }
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "nin":
      return Array.isArray(right) && !right.includes(left);
    case "contains":
      if (Array.isArray(left)) {
        return left.includes(right);
      }
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.includes(right)
      );
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const comparable =
        (typeof left === "number" && typeof right === "number") ||
        (typeof left === "string" && typeof right === "string");
      if (!comparable) {
        return false;
      }
      if (op === "gt") return left > right;
      if (op === "gte") return left >= right;
      if (op === "lt") return left < right;
      return left <= right;
    }
    default:
      return false;
  }
};

const compilePath = (path: unknown, where: string): readonly string[] => {
  const segments = parsePath(path);
  const root = segments?.[0];
  if (!segments || root === undefined || !ROOTS.has(root)) {
    throw new InvalidPolicyError(
      `${where}: invalid field path "${String(path)}"; it must start with subject, action, resource or context.`,
    );
  }
  return segments;
};

type Check = (input: EvaluationInput) => boolean;

const compileCondition = (condition: Condition, where: string): Check => {
  const candidate = condition as Partial<Condition> | null;
  if (typeof candidate !== "object" || candidate === null) {
    throw new InvalidPolicyError(`${where}: condition must be an object.`);
  }
  const { op, value, valueFrom } = candidate;
  if (typeof op !== "string" || !OPERATORS.has(op)) {
    throw new InvalidPolicyError(`${where}: unknown operator "${String(op)}".`);
  }
  const operator = op as ConditionOperator;
  const field = compilePath(candidate.field, where);

  if (operator === "exists") {
    if (typeof value !== "boolean" || valueFrom !== undefined) {
      throw new InvalidPolicyError(
        `${where}: "exists" requires a boolean \`value\` and no \`valueFrom\`.`,
      );
    }
    return (input) => (readPath(input, field) !== undefined) === value;
  }

  if ((value === undefined) === (valueFrom === undefined)) {
    throw new InvalidPolicyError(
      `${where}: provide exactly one of \`value\` or \`valueFrom\`.`,
    );
  }
  if (valueFrom !== undefined) {
    const other = compilePath(valueFrom, where);
    return (input) =>
      compare(operator, readPath(input, field), readPath(input, other));
  }
  if ((operator === "in" || operator === "nin") && !Array.isArray(value)) {
    throw new InvalidPolicyError(
      `${where}: "${operator}" requires an array \`value\`.`,
    );
  }
  return (input) => compare(operator, readPath(input, field), value);
};

const compileScope = (
  scope: unknown,
  label: string,
  where: string,
): ((value: string) => boolean) => {
  if (scope === undefined) {
    return () => true;
  }
  if (
    !Array.isArray(scope) ||
    scope.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new InvalidPolicyError(
      `${where}: \`${label}\` must be an array of non-empty strings.`,
    );
  }
  const values = new Set<string>(scope);
  return values.has("*") ? () => true : (value) => values.has(value);
};

/**
 * Creates an ABAC evaluator from a list of policies.
 *
 * A matching `deny` policy yields `deny`, otherwise a matching `allow` policy yields `allow`;
 * with no matching policy it has no opinion.
 *
 * @throws {InvalidPolicyError} On malformed policies, duplicate ids, or unsafe field paths.
 *
 * @example
 * const abac = createAbacEvaluator({
 *   policies: [
 *     {
 *       id: "same-department",
 *       effect: "allow",
 *       actions: ["read"],
 *       conditions: [
 *         { field: "subject.attributes.department", op: "eq", valueFrom: "resource.attributes.department" },
 *       ],
 *     },
 *   ],
 * });
 */
export function createAbacEvaluator(config: AbacConfig): Evaluator {
  const rawPolicies: unknown = config?.policies;
  if (!Array.isArray(rawPolicies)) {
    throw new InvalidPolicyError(
      "ABAC config requires `policies` to be an array.",
    );
  }

  const ids = new Set<string>();
  const compiled = rawPolicies.map((policy: Partial<AbacPolicy> | null) => {
    if (typeof policy !== "object" || policy === null) {
      throw new InvalidPolicyError("Each policy must be an object.");
    }
    const { id, effect } = policy;
    if (typeof id !== "string" || id === "") {
      throw new InvalidPolicyError(
        "Each policy requires a non-empty string `id`.",
      );
    }
    if (ids.has(id)) {
      throw new InvalidPolicyError(`Duplicate policy id "${id}".`);
    }
    ids.add(id);
    const where = `Policy "${id}"`;
    if (effect !== "allow" && effect !== "deny") {
      throw new InvalidPolicyError(
        `${where}: \`effect\` must be "allow" or "deny".`,
      );
    }
    if (policy.conditions !== undefined && !Array.isArray(policy.conditions)) {
      throw new InvalidPolicyError(
        `${where}: \`conditions\` must be an array.`,
      );
    }
    const matchesAction = compileScope(policy.actions, "actions", where);
    const matchesResource = compileScope(policy.resources, "resources", where);
    const checks = (policy.conditions ?? []).map((condition) =>
      compileCondition(condition, where),
    );
    return {
      checks,
      effect,
      id,
      matchesAction,
      matchesResource,
    };
  });

  return (input) => {
    let allowedBy: string | undefined;
    for (const policy of compiled) {
      if (
        !policy.matchesAction(input.action) ||
        !policy.matchesResource(input.resource.type)
      ) {
        continue;
      }
      if (!policy.checks.every((check) => check(input))) {
        continue;
      }
      if (policy.effect === "deny") {
        return {
          effect: "deny",
          reason: `Policy "${policy.id}" denies access.`,
        };
      }
      allowedBy ??= policy.id;
    }
    return allowedBy === undefined
      ? undefined
      : {
          effect: "allow",
          reason: `Policy "${allowedBy}" allows access.`,
        };
  };
}
