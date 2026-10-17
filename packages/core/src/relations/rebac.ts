import { InvalidPolicyError } from "../errors.js";
import { ownProperty } from "../own.js";
import type { Evaluator, ResourceName, Schema } from "../types/index.js";
import type { RelationGraph } from "./graph.js";

/**
 * The relation a subject must hold on a resource to perform an action, keyed by resource
 * type then action. With a schema, only its resource types and their actions are accepted.
 */
export type RebacRequirements<S extends Schema = Schema> = {
  readonly [T in ResourceName<S>]?: {
    readonly [A in S[T]]?: string;
  };
};

/** Configuration for {@link createRebacEvaluator}. */
export type RebacConfig<S extends Schema = Schema> = {
  readonly graph: RelationGraph;
  /**
   * The relation a subject must hold on a resource to perform an action, keyed by
   * resource type then action, e.g. `{ document: { read: "viewer", update: "editor" } }`.
   */
  readonly requirements: RebacRequirements<S>;
};

/**
 * Creates a ReBAC evaluator. The subject reference is `subject.id` and the resource
 * reference is `"<type>:<id>"`; both must match the references used in the graph's tuples.
 *
 * It only ever grants: it returns `allow` when the subject holds the required relation,
 * and has no opinion otherwise (including resources without an `id` or unmapped actions).
 *
 * @throws {InvalidPolicyError} If `graph` or `requirements` are malformed.
 *
 * @example
 * const rebac = createRebacEvaluator({
 *   graph,
 *   requirements: { doc: { read: "viewer", update: "editor" } },
 * });
 */
export function createRebacEvaluator<S extends Schema = Schema>(
  config: RebacConfig<S>,
): Evaluator<S> {
  const graph: unknown = config?.graph;
  if (
    typeof graph !== "object" ||
    graph === null ||
    typeof (graph as RelationGraph).check !== "function"
  ) {
    throw new InvalidPolicyError(
      "ReBAC config requires a `graph` created with createRelationGraph.",
      {
        code: "REBAC_GRAPH_REQUIRED",
      },
    );
  }
  const rawRequirements: unknown = config.requirements;
  if (
    typeof rawRequirements !== "object" ||
    rawRequirements === null ||
    Array.isArray(rawRequirements)
  ) {
    throw new InvalidPolicyError(
      "ReBAC config requires `requirements` to be an object.",
      {
        code: "REBAC_REQUIREMENTS_INVALID",
      },
    );
  }

  const requirements = new Map<string, Map<string, string>>();
  for (const [type, actions] of Object.entries(rawRequirements)) {
    if (
      typeof actions !== "object" ||
      actions === null ||
      Array.isArray(actions)
    ) {
      throw new InvalidPolicyError(
        `Requirements for resource type "${type}" must be an object.`,
        {
          code: "REBAC_REQUIREMENT_TYPE_INVALID",
          params: {
            resourceType: type,
          },
        },
      );
    }
    const byAction = new Map<string, string>();
    for (const [action, relation] of Object.entries(actions)) {
      if (typeof relation !== "string" || relation === "") {
        throw new InvalidPolicyError(
          `Requirement "${type}:${action}" must be a non-empty relation name.`,
          {
            code: "REBAC_REQUIREMENT_INVALID",
            params: {
              action,
              resourceType: type,
            },
          },
        );
      }
      byAction.set(action, relation);
    }
    requirements.set(type, byAction);
  }

  const { check } = graph as RelationGraph;

  const evaluator: Evaluator = ({ action, resource, subject }) => {
    const relation = requirements.get(resource.type)?.get(action);
    const id = ownProperty(resource, "id");
    if (relation === undefined || id === undefined) {
      return undefined;
    }
    const object = `${resource.type}:${String(id)}`;
    return check(subject.id, relation, object)
      ? {
          code: "RELATION_GRANTS",
          effect: "allow",
          params: {
            object,
            relation,
          },
          reason: `Subject holds "${relation}" on "${object}".`,
        }
      : undefined;
  };

  return evaluator as unknown as Evaluator<S>;
}
