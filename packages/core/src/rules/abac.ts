import { InvalidPolicyError } from "../errors.js";
import { ownProperty } from "../own.js";
import type {
  ActionName,
  EvaluationInput,
  Evaluator,
  ResourceName,
  Schema,
} from "../types/index.js";
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
export type FieldCondition = {
  readonly field: string;
  readonly op: ConditionOperator;
  readonly value?: unknown;
  readonly valueFrom?: string;
};

/** Holds when **every** condition in the (non-empty) list holds. */
export type AllCondition = {
  readonly all: readonly Condition[];
};

/** Holds when **at least one** condition in the (non-empty) list holds. */
export type AnyCondition = {
  readonly any: readonly Condition[];
};

/**
 * Holds when the condition inside does **not** hold. Careful: a condition that fails only
 * because a value is missing becomes true under `not`. Prefer positive conditions in `allow`
 * policies and express exclusions as `deny` policies.
 */
export type NotCondition = {
  readonly not: Condition;
};

/**
 * A test on the request: a {@link FieldCondition}, or `all` / `any` / `not` combining other
 * conditions, nested up to {@link MAX_CONDITION_DEPTH} levels.
 */
export type Condition =
  | FieldCondition
  | AllCondition
  | AnyCondition
  | NotCondition;

/** How many levels of `all` / `any` / `not` a condition may nest. Deeper conditions are rejected. */
export const MAX_CONDITION_DEPTH = 8;

/**
 * An attribute-based policy. All top-level `conditions` must hold (AND) for the policy to
 * apply; use `any` and `not` inside them for OR and NOT.
 */
export type AbacPolicy<S extends Schema = Schema> = {
  /** Unique identifier, used in decision reasons. */
  readonly id: string;
  readonly effect: "allow" | "deny";
  /** Actions this policy applies to. Omit (or use `"*"`) for any action. */
  readonly actions?: readonly (ActionName<S> | "*")[];
  /** Resource types this policy applies to. Omit (or use `"*"`) for any type. */
  readonly resources?: readonly (ResourceName<S> | "*")[];
  readonly conditions?: readonly Condition[];
};

/** Configuration for {@link createAbacEvaluator}. */
export type AbacConfig<S extends Schema = Schema> = {
  readonly policies: readonly AbacPolicy<S>[];
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
const MAX_SCOPE_CACHE_ENTRIES = 1024;
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

const clip = (value: unknown): string => String(value).slice(0, 64);

const compilePath = (path: unknown, policyId: string): readonly string[] => {
  const where = `Policy "${policyId}"`;
  const segments = parsePath(path);
  const root = segments?.[0];
  if (!segments || root === undefined || !ROOTS.has(root)) {
    throw new InvalidPolicyError(
      `${where}: invalid field path "${clip(path)}"; it must start with subject, action, resource or context.`,
      {
        code: "CONDITION_FIELD_INVALID",
        params: {
          field: clip(path),
          policyId,
        },
      },
    );
  }
  return segments;
};

type Check = (input: EvaluationInput) => boolean;

const compileField = (node: object, policyId: string): Check => {
  const where = `Policy "${policyId}"`;
  const op = ownProperty(node, "op");
  const value = ownProperty(node, "value");
  const valueFrom = ownProperty(node, "valueFrom");
  if (typeof op !== "string" || !OPERATORS.has(op)) {
    throw new InvalidPolicyError(`${where}: unknown operator "${clip(op)}".`, {
      code: "CONDITION_OPERATOR_UNKNOWN",
      params: {
        operator: clip(op),
        policyId,
      },
    });
  }
  const operator = op as ConditionOperator;
  const field = compilePath(ownProperty(node, "field"), policyId);

  if (operator === "exists") {
    if (typeof value !== "boolean" || valueFrom !== undefined) {
      throw new InvalidPolicyError(
        `${where}: "exists" requires a boolean \`value\` and no \`valueFrom\`.`,
        {
          code: "CONDITION_EXISTS_INVALID",
          params: {
            policyId,
          },
        },
      );
    }
    return (input) => (readPath(input, field) !== undefined) === value;
  }

  if ((value === undefined) === (valueFrom === undefined)) {
    throw new InvalidPolicyError(
      `${where}: provide exactly one of \`value\` or \`valueFrom\`.`,
      {
        code: "CONDITION_VALUE_SOURCE_INVALID",
        params: {
          policyId,
        },
      },
    );
  }
  if (valueFrom !== undefined) {
    const other = compilePath(valueFrom, policyId);
    return (input) =>
      compare(operator, readPath(input, field), readPath(input, other));
  }
  if ((operator === "in" || operator === "nin") && !Array.isArray(value)) {
    throw new InvalidPolicyError(
      `${where}: "${operator}" requires an array \`value\`.`,
      {
        code: "CONDITION_ARRAY_REQUIRED",
        params: {
          operator,
          policyId,
        },
      },
    );
  }
  return (input) => compare(operator, readPath(input, field), value);
};

/** Compiles a condition tree into a function. Reads own properties only. */
const compileNode = (node: unknown, policyId: string, depth: number): Check => {
  const where = `Policy "${policyId}"`;
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new InvalidPolicyError(`${where}: condition must be an object.`, {
      code: "CONDITION_NOT_OBJECT",
      params: {
        policyId,
      },
    });
  }
  if (depth > MAX_CONDITION_DEPTH) {
    throw new InvalidPolicyError(
      `${where}: conditions are nested deeper than ${MAX_CONDITION_DEPTH} levels.`,
      {
        code: "CONDITION_TOO_DEEP",
        params: {
          maxDepth: MAX_CONDITION_DEPTH,
          policyId,
        },
      },
    );
  }

  const groups = (
    [
      "all",
      "any",
      "not",
    ] as const
  ).filter((key) => Object.hasOwn(node, key));
  const isField = Object.hasOwn(node, "field") || Object.hasOwn(node, "op");
  if (groups.length + (isField ? 1 : 0) !== 1) {
    throw new InvalidPolicyError(
      `${where}: a condition must be exactly one of a field comparison, \`all\`, \`any\`, or \`not\`.`,
      {
        code: "CONDITION_SHAPE_INVALID",
        params: {
          policyId,
        },
      },
    );
  }

  const group = groups[0];
  if (group === undefined) {
    return compileField(node, policyId);
  }
  if (group === "not") {
    const inner = compileNode(ownProperty(node, "not"), policyId, depth + 1);
    return (input) => !inner(input);
  }
  const children = ownProperty(node, group);
  if (!Array.isArray(children) || children.length === 0) {
    throw new InvalidPolicyError(
      `${where}: \`${group}\` requires a non-empty array of conditions.`,
      {
        code: "CONDITION_GROUP_INVALID",
        params: {
          operator: group,
          policyId,
        },
      },
    );
  }
  const checks = children.map((child) =>
    compileNode(child, policyId, depth + 1),
  );
  return group === "all"
    ? (input) => checks.every((check) => check(input))
    : (input) => checks.some((check) => check(input));
};

const compileScope = (
  scope: unknown,
  label: string,
  policyId: string,
): ((value: string) => boolean) => {
  const where = `Policy "${policyId}"`;
  if (scope === undefined) {
    return () => true;
  }
  if (
    !Array.isArray(scope) ||
    scope.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new InvalidPolicyError(
      `${where}: \`${label}\` must be an array of non-empty strings.`,
      {
        code: "POLICY_SCOPE_INVALID",
        params: {
          option: label,
          policyId,
        },
      },
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
export function createAbacEvaluator<S extends Schema = Schema>(
  config: AbacConfig<S>,
): Evaluator<S> {
  const rawPolicies: unknown = config?.policies;
  if (!Array.isArray(rawPolicies)) {
    throw new InvalidPolicyError(
      "ABAC config requires `policies` to be an array.",
      {
        code: "ABAC_POLICIES_INVALID",
      },
    );
  }

  const ids = new Set<string>();
  const compiled = rawPolicies.map(
    (policy: Partial<AbacPolicy> | null, index: number) => {
      if (typeof policy !== "object" || policy === null) {
        throw new InvalidPolicyError(
          `Policy at index ${index} must be an object.`,
          {
            code: "POLICY_NOT_OBJECT",
            params: {
              index,
            },
          },
        );
      }
      const { id, effect } = policy;
      if (typeof id !== "string" || id === "") {
        throw new InvalidPolicyError(
          `Policy at index ${index} requires a non-empty string \`id\`.`,
          {
            code: "POLICY_ID_INVALID",
            params: {
              index,
            },
          },
        );
      }
      if (ids.has(id)) {
        throw new InvalidPolicyError(`Duplicate policy id "${id}".`, {
          code: "POLICY_ID_DUPLICATE",
          params: {
            policyId: id,
          },
        });
      }
      ids.add(id);
      const where = `Policy "${id}"`;
      if (effect !== "allow" && effect !== "deny") {
        throw new InvalidPolicyError(
          `${where}: \`effect\` must be "allow" or "deny".`,
          {
            code: "POLICY_EFFECT_INVALID",
            params: {
              policyId: id,
            },
          },
        );
      }
      if (
        policy.conditions !== undefined &&
        !Array.isArray(policy.conditions)
      ) {
        throw new InvalidPolicyError(
          `${where}: \`conditions\` must be an array.`,
          {
            code: "POLICY_CONDITIONS_INVALID",
            params: {
              policyId: id,
            },
          },
        );
      }
      const matchesAction = compileScope(policy.actions, "actions", id);
      const matchesResource = compileScope(policy.resources, "resources", id);
      const checks = (policy.conditions ?? []).map((condition) =>
        compileNode(condition, id, 0),
      );
      return {
        checks,
        effect,
        id,
        matchesAction,
        matchesResource,
      };
    },
  );

  // Policies whose scope matches an (action, resource type) pair, in declaration order,
  // memoized so evaluation only runs conditions for policies that can apply. Bounded so
  // arbitrary action/type strings cannot grow it without limit.
  const scopeCache = new Map<string, readonly (typeof compiled)[number][]>();
  const candidatesFor = (action: string, type: string) => {
    const key = `${action}\u0000${type}`;
    let candidates = scopeCache.get(key);
    if (candidates === undefined) {
      candidates = compiled.filter(
        (policy) =>
          policy.matchesAction(action) && policy.matchesResource(type),
      );
      if (scopeCache.size >= MAX_SCOPE_CACHE_ENTRIES) {
        scopeCache.clear();
      }
      scopeCache.set(key, candidates);
    }
    return candidates;
  };

  const evaluator: Evaluator = (input) => {
    let allowedBy: string | undefined;
    for (const policy of candidatesFor(input.action, input.resource.type)) {
      if (!policy.checks.every((check) => check(input))) {
        continue;
      }
      if (policy.effect === "deny") {
        return {
          code: "POLICY_DENIES",
          effect: "deny",
          params: {
            policyId: policy.id,
          },
          reason: `Policy "${policy.id}" denies access.`,
        };
      }
      allowedBy ??= policy.id;
    }
    return allowedBy === undefined
      ? undefined
      : {
          code: "POLICY_ALLOWS",
          effect: "allow",
          params: {
            policyId: allowedBy,
          },
          reason: `Policy "${allowedBy}" allows access.`,
        };
  };

  return evaluator as unknown as Evaluator<S>;
}
