import { InvalidPolicyError } from "../errors.js";
import type { RelationGraph, RelationRule, RelationTuple } from "./graph.js";
import { createRelationGraph } from "./graph.js";

/** Configuration for {@link createTenantRelationGraph}. */
export type TenantRelationGraphConfig = {
  /** Relation tuples of each tenant, keyed by tenant id. Tenants never see each other's tuples. */
  readonly tuples: Readonly<Record<string, readonly RelationTuple[]>>;
  /** Rewrite rules shared by every tenant. */
  readonly rules?: Readonly<Record<string, RelationRule>>;
  /** Maximum traversal depth, as in {@link createRelationGraph}. */
  readonly maxDepth?: number;
};

/** One isolated relation graph per tenant. */
export type TenantRelationGraph = {
  /** The graph of a tenant, or `undefined` when that tenant is unknown. */
  readonly forTenant: (tenantId: string) => RelationGraph | undefined;
  /** Shorthand: `forTenant(tenantId)?.check(...) ?? false`. An unknown tenant has no relations. */
  readonly check: (
    tenantId: string,
    subject: string,
    relation: string,
    object: string,
  ) => boolean;
  /** The ids of the tenants this graph knows. */
  readonly tenants: () => readonly string[];
};

/**
 * Builds one separate relation graph per tenant, so a relation in one tenant can never grant
 * access in another, even if their references look alike. Pass it to `createRebacEvaluator` and
 * the evaluator picks the graph by `context.tenantId`; with no tenant, or an unknown one, it has
 * no opinion (so the result is `deny`).
 *
 * @throws {InvalidPolicyError} If `tuples` is not an object keyed by non-empty tenant ids, or a
 * tenant's tuples or the shared rules are malformed (the error names the tenant).
 *
 * @example
 * const graph = createTenantRelationGraph({
 *   tuples: {
 *     acme: [{ object: "doc:1", relation: "viewer", subject: "user:ana" }],
 *     globex: [{ object: "doc:1", relation: "viewer", subject: "user:bob" }],
 *   },
 * });
 * graph.check("acme", "user:ana", "viewer", "doc:1"); // true
 * graph.check("globex", "user:ana", "viewer", "doc:1"); // false
 */
export function createTenantRelationGraph(
  config: TenantRelationGraphConfig,
): TenantRelationGraph {
  const rawTuples: unknown = config?.tuples;
  if (
    typeof rawTuples !== "object" ||
    rawTuples === null ||
    Array.isArray(rawTuples)
  ) {
    throw new InvalidPolicyError(
      "Tenant graph config requires `tuples` to be an object keyed by tenant id.",
      {
        code: "TENANT_GRAPH_INVALID",
      },
    );
  }

  const graphs = new Map<string, RelationGraph>();
  for (const [tenantId, tuples] of Object.entries(rawTuples)) {
    if (tenantId === "") {
      throw new InvalidPolicyError("A tenant id cannot be empty.", {
        code: "TENANT_ID_INVALID",
      });
    }
    try {
      graphs.set(
        tenantId,
        createRelationGraph({
          tuples: tuples as readonly RelationTuple[],
          ...(config.rules === undefined
            ? {}
            : {
                rules: config.rules,
              }),
          ...(config.maxDepth === undefined
            ? {}
            : {
                maxDepth: config.maxDepth,
              }),
        }),
      );
    } catch (error) {
      if (error instanceof InvalidPolicyError) {
        throw new InvalidPolicyError(`Tenant "${tenantId}": ${error.message}`, {
          cause: error,
          code: error.code,
          params: {
            ...error.params,
            tenantId,
          },
        });
      }
      throw error;
    }
  }

  const ids = Object.freeze([
    ...graphs.keys(),
  ]);
  const forTenant = (tenantId: string): RelationGraph | undefined =>
    typeof tenantId === "string" ? graphs.get(tenantId) : undefined;

  return Object.freeze({
    check: (
      tenantId: string,
      subject: string,
      relation: string,
      object: string,
    ): boolean =>
      forTenant(tenantId)?.check(subject, relation, object) ?? false,
    forTenant,
    tenants: (): readonly string[] => ids,
  });
}
