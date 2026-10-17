import type { RelationTuple } from "@useguardril/core";
import { AdapterMappingError } from "@useguardril/core";
import { compilePath, readList, readPath, toIdentifier } from "./path.js";
import type { Adapter } from "./types.js";

/** Where to find each field of a relation record, as dot paths relative to each record. */
export type TuplesMapping = {
  /** Path to the array of records. Omit when the response itself is the array. */
  readonly list?: string;
  /** Path (within each record) to the object reference, e.g. `"document:1"`. */
  readonly object: string;
  /** Path (within each record) to the relation name. */
  readonly relation: string;
  /** Path (within each record) to the subject reference, e.g. `"user:ana"` or `"team:eng#member"`. */
  readonly subject: string;
};

const requireReference = (
  value: unknown,
  label: string,
  index: number,
): string => {
  const reference = toIdentifier(value);
  if (reference === undefined) {
    throw new AdapterMappingError(
      `${label}: record ${index} has no usable ${label}.`,
    );
  }
  return reference;
};

/**
 * Creates an adapter for any backend that returns relation records, using configurable paths.
 *
 * @throws {AdapterMappingError} At creation for invalid paths, and when adapting if a record
 * lacks an object, relation, or subject.
 *
 * @example
 * const adapt = createTuplesAdapter({ list: "grants", object: "resource", relation: "role", subject: "principal" });
 * const graph = createRelationGraph({ tuples: adapt(await fetchGrants()) });
 */
export function createTuplesAdapter(
  mapping: TuplesMapping,
): Adapter<RelationTuple[]> {
  const list =
    mapping?.list === undefined ? undefined : compilePath(mapping.list, "list");
  const object = compilePath(mapping?.object, "object");
  const relation = compilePath(mapping?.relation, "relation");
  const subject = compilePath(mapping?.subject, "subject");

  return (response) =>
    readList(response, list, "tuples").map((record, index) => ({
      object: requireReference(readPath(record, object), "object", index),
      relation: requireReference(readPath(record, relation), "relation", index),
      subject: requireReference(readPath(record, subject), "subject", index),
    }));
}

const openFga = createTuplesAdapter({
  list: "tuples",
  object: "key.object",
  relation: "key.relation",
  subject: "key.user",
});

/**
 * Adapter for an OpenFGA `Read` response (`{ tuples: [{ key: { user, relation, object } }] }`).
 * Userset subjects such as `"team:eng#member"` map directly. Wildcard subjects (`"user:*"`)
 * are kept as written and match nobody, because the core graph has no wildcard support.
 */
export const openFgaTuplesAdapter: Adapter<RelationTuple[]> = openFga;

type SpiceDbObject = {
  objectType?: unknown;
  objectId?: unknown;
};

const spiceDbReference = (
  value: unknown,
  label: string,
  index: number,
): string => {
  const { objectId, objectType } = (value ?? {}) as SpiceDbObject;
  const type = toIdentifier(objectType);
  const id = toIdentifier(objectId);
  if (type === undefined || id === undefined) {
    throw new AdapterMappingError(
      `${label}: record ${index} has no usable ${label}.`,
    );
  }
  return `${type}:${id}`;
};

const SPICEDB_LIST = compilePath("relationships", "relationships");
const SPICEDB_RELATIONSHIP = compilePath("relationship", "relationship");
const SPICEDB_WRAPPED_RELATIONSHIP = compilePath(
  "result.relationship",
  "relationship",
);

/**
 * Adapter for SpiceDB `ReadRelationships` output: an array (or `{ relationships: [...] }`)
 * whose items hold a `relationship` (or `result.relationship`) with `resource`, `relation`, and
 * `subject.object` plus an optional `subject.optionalRelation` for usersets.
 */
export const spiceDbTuplesAdapter: Adapter<RelationTuple[]> = (response) => {
  const isWrapped =
    typeof response === "object" &&
    response !== null &&
    !Array.isArray(response);
  const records = readList(
    response,
    isWrapped ? SPICEDB_LIST : undefined,
    "relationships",
  );

  return records.map((record, index) => {
    const relationship =
      readPath(record, SPICEDB_RELATIONSHIP) ??
      readPath(record, SPICEDB_WRAPPED_RELATIONSHIP);
    const data = (relationship ?? {}) as {
      relation?: unknown;
      resource?: unknown;
      subject?: {
        object?: unknown;
        optionalRelation?: unknown;
      } | null;
    };

    const optional = toIdentifier(data.subject?.optionalRelation);
    const subjectReference = spiceDbReference(
      data.subject?.object,
      "subject",
      index,
    );

    return {
      object: spiceDbReference(data.resource, "object", index),
      relation: requireReference(data.relation, "relation", index),
      subject:
        optional === undefined
          ? subjectReference
          : `${subjectReference}#${optional}`,
    };
  });
};
