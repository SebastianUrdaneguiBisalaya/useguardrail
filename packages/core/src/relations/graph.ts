import { InvalidPolicyError } from "../errors.js";

/**
 * A fact: `subject` has `relation` on `object`.
 *
 * Objects and subjects are opaque references chosen by the consumer (e.g. `"document:1"`,
 * `"user:ana"`). A subject may be a userset, `"<ref>#<relation>"` (e.g. `"team:eng#member"`),
 * meaning everyone who has that relation on that reference. A subject may also be a wildcard,
 * `"<type>:*"` (e.g. `"user:*"`), meaning every subject whose reference starts with `"<type>:"`
 * (public access). A wildcard cannot be part of a userset.
 */
export type RelationTuple = {
  readonly object: string;
  readonly relation: string;
  readonly subject: string;
};

/** Follows a link relation to another object and inherits one of its relations. */
export type InheritRule = {
  /** Relation on the current object that points to the parent (e.g. `"parent"`). */
  readonly via: string;
  /** Relation on the parent whose holders also hold the current relation. */
  readonly relation: string;
};

/** How a relation can also be obtained without a direct tuple. */
export type RelationRule = {
  /** Relations on the same object that imply this one (e.g. `editor` implies `viewer`). */
  readonly impliedBy?: readonly string[];
  /** Relations inherited from related objects (e.g. a document inherits its folder's viewers). */
  readonly inheritFrom?: readonly InheritRule[];
};

/** Configuration for {@link createRelationGraph}. */
export type RelationGraphConfig = {
  readonly tuples: readonly RelationTuple[];
  /** Rewrite rules keyed by relation name. */
  readonly rules?: Readonly<Record<string, RelationRule>>;
  /** Maximum traversal depth. Deeper paths are treated as not related. Defaults to 16. */
  readonly maxDepth?: number;
};

/** A queryable, immutable relation graph. */
export type RelationGraph = {
  /**
   * Whether `subject` holds `relation` on `object`, directly or through usersets,
   * implied relations, and inheritance. Cycle-safe and depth-limited; never throws.
   */
  readonly check: (
    subject: string,
    relation: string,
    object: string,
  ) => boolean;
};

const DEFAULT_MAX_DEPTH = 16;

const isReference = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isReference);

const WILDCARD_SUFFIX = ":*";

/** A `<type>:*` reference: everyone whose reference starts with `<type>:`. */
const isWildcard = (reference: string): boolean =>
  reference.endsWith(WILDCARD_SUFFIX);

/** Valid subjects are `<ref>`, `<type>:*`, or `<ref>#<relation>` (never a wildcard userset). */
const isValidSubject = (subject: string): boolean => {
  const parts = subject.split("#");
  if (parts.length > 2 || parts.some((part) => part === "")) {
    return false;
  }
  const reference = parts[0] as string;
  if (isWildcard(reference)) {
    return parts.length === 1 && reference.length > WILDCARD_SUFFIX.length;
  }
  return true;
};

/** Whether a tuple's wildcard subject (`user:*`) covers a concrete subject (`user:ana`). */
const wildcardCovers = (wildcard: string, subject: string): boolean =>
  isWildcard(wildcard) &&
  !isWildcard(subject) &&
  subject.startsWith(wildcard.slice(0, -1)) &&
  subject.length > wildcard.length - 1;

/**
 * Builds a relation graph (ReBAC) from tuples and optional rewrite rules.
 * The inputs are copied, so later mutation by the caller has no effect.
 *
 * @throws {InvalidPolicyError} On malformed tuples, rules, or `maxDepth`.
 *
 * @example
 * const graph = createRelationGraph({
 *   tuples: [
 *     { object: "folder:1", relation: "viewer", subject: "user:ana" },
 *     { object: "doc:1", relation: "parent", subject: "folder:1" },
 *   ],
 *   rules: { viewer: { inheritFrom: [{ via: "parent", relation: "viewer" }] } },
 * });
 * graph.check("user:ana", "viewer", "doc:1"); // true
 */
export function createRelationGraph(
  config: RelationGraphConfig,
): RelationGraph {
  const rawTuples: unknown = config?.tuples;
  if (!Array.isArray(rawTuples)) {
    throw new InvalidPolicyError(
      "Relation graph config requires `tuples` to be an array.",
      {
        code: "GRAPH_TUPLES_INVALID",
      },
    );
  }

  const index = new Map<string, string[]>();
  for (const [position, tuple] of (
    rawTuples as Array<Partial<RelationTuple> | null>
  ).entries()) {
    if (typeof tuple !== "object" || tuple === null) {
      throw new InvalidPolicyError(
        `Relation tuple at index ${position} must be an object.`,
        {
          code: "TUPLE_NOT_OBJECT",
          params: {
            index: position,
          },
        },
      );
    }
    const { object, relation, subject } = tuple;
    if (
      !isReference(object) ||
      !isReference(relation) ||
      !isReference(subject)
    ) {
      throw new InvalidPolicyError(
        `Relation tuple at index ${position} requires non-empty string \`object\`, \`relation\`, and \`subject\`.`,
        {
          code: "TUPLE_FIELDS_INVALID",
          params: {
            index: position,
          },
        },
      );
    }
    if (
      object.includes("#") ||
      relation.includes("#") ||
      !isValidSubject(subject)
    ) {
      throw new InvalidPolicyError(
        `Relation tuple at index ${position} is invalid: "#" is only allowed once in a subject, as "<ref>#<relation>", and a "<type>:*" wildcard cannot be part of a userset.`,
        {
          code: "TUPLE_REFERENCE_INVALID",
          params: {
            index: position,
          },
        },
      );
    }
    const key = `${object}#${relation}`;
    const subjects = index.get(key);
    if (subjects) {
      subjects.push(subject);
    } else {
      index.set(key, [
        subject,
      ]);
    }
  }

  const rawRules: unknown = config.rules ?? {};
  if (
    typeof rawRules !== "object" ||
    rawRules === null ||
    Array.isArray(rawRules)
  ) {
    throw new InvalidPolicyError("Relation graph `rules` must be an object.", {
      code: "GRAPH_RULES_INVALID",
    });
  }
  const rules = new Map<string, RelationRule>();
  for (const [relation, rule] of Object.entries(rawRules)) {
    const candidate = rule as Partial<RelationRule> | null;
    if (typeof candidate !== "object" || candidate === null) {
      throw new InvalidPolicyError(
        `Rule for relation "${relation}" must be an object.`,
        {
          code: "RULE_NOT_OBJECT",
          params: {
            relation,
          },
        },
      );
    }
    if (
      candidate.impliedBy !== undefined &&
      !isStringArray(candidate.impliedBy)
    ) {
      throw new InvalidPolicyError(
        `Rule "${relation}": \`impliedBy\` must be an array of non-empty strings.`,
        {
          code: "RULE_IMPLIED_BY_INVALID",
          params: {
            relation,
          },
        },
      );
    }
    const inherit: unknown = candidate.inheritFrom;
    if (
      inherit !== undefined &&
      (!Array.isArray(inherit) ||
        inherit.some(
          (item: Partial<InheritRule> | null) =>
            typeof item !== "object" ||
            item === null ||
            !isReference(item.via) ||
            !isReference(item.relation),
        ))
    ) {
      throw new InvalidPolicyError(
        `Rule "${relation}": \`inheritFrom\` must be an array of { via, relation }.`,
        {
          code: "RULE_INHERIT_FROM_INVALID",
          params: {
            relation,
          },
        },
      );
    }
    rules.set(relation, candidate as RelationRule);
  }

  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new InvalidPolicyError(
      "Relation graph `maxDepth` must be a positive integer.",
      {
        code: "GRAPH_MAX_DEPTH_INVALID",
      },
    );
  }

  const check = (
    subject: string,
    relation: string,
    object: string,
  ): boolean => {
    if (
      !isReference(subject) ||
      !isReference(relation) ||
      !isReference(object)
    ) {
      return false;
    }
    const visited = new Set<string>();

    const walk = (current: string, target: string, depth: number): boolean => {
      if (depth > maxDepth) {
        return false;
      }
      const key = `${target}#${current}`;
      if (visited.has(key)) {
        return false;
      }
      visited.add(key);

      for (const candidate of index.get(key) ?? []) {
        if (candidate === subject || wildcardCovers(candidate, subject)) {
          return true;
        }
        const hash = candidate.indexOf("#");
        if (
          hash !== -1 &&
          walk(candidate.slice(hash + 1), candidate.slice(0, hash), depth + 1)
        ) {
          return true;
        }
      }

      const rule = rules.get(current);
      for (const implied of rule?.impliedBy ?? []) {
        if (walk(implied, target, depth + 1)) {
          return true;
        }
      }
      for (const { via, relation: inherited } of rule?.inheritFrom ?? []) {
        for (const parent of index.get(`${target}#${via}`) ?? []) {
          if (walk(inherited, parent, depth + 1)) {
            return true;
          }
        }
      }
      return false;
    };

    return walk(relation, object, 0);
  };

  return Object.freeze({
    check,
  });
}
