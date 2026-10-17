import type { RoleDefinition } from "@useguardrail/core";
import { AdapterMappingError } from "@useguardrail/core";
import { compilePath, readList, readPath, toIdentifier } from "./path.js";
import type { Adapter } from "./types.js";

/** Where to find each field of a roles response, as dot paths relative to each role record. */
export type RolesMapping = {
  /** Path to the array of roles. Omit when the response itself is the array. */
  readonly list?: string;
  /** Path (within each role) to its name. */
  readonly name: string;
  /** Path (within each role) to its permissions: an array of `"<resource>:<action>"` strings. */
  readonly permissions: string;
  /** Path (within each role) to the names of the roles it inherits from. Optional. */
  readonly inherits?: string;
};

const readStringList = (
  value: unknown,
  field: "permissions" | "inherits",
  record: number,
): readonly string[] | undefined => {
  const label = `roles: record ${record} ${field}`;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new AdapterMappingError(`${label}: expected an array.`, {
      code: "ADAPTER_STRING_LIST_INVALID",
      params: {
        field,
        index: record,
      },
    });
  }
  return value.map((item, index) => {
    const text = toIdentifier(item);
    if (text === undefined) {
      throw new AdapterMappingError(
        `${label}: entry ${index} is not a usable string.`,
        {
          code: "ADAPTER_STRING_LIST_INVALID",
          params: {
            entry: index,
            field,
            index: record,
          },
        },
      );
    }
    return text;
  });
};

/**
 * Creates an adapter that turns a backend's roles response into the `roles` object that
 * `createRbacEvaluator` expects.
 *
 * @throws {AdapterMappingError} At creation for invalid paths, and when adapting if a role
 * has no name, permissions are not an array of strings, or two roles share a name.
 *
 * @example
 * const adapt = createRolesAdapter({
 *   list: "data.roles",
 *   name: "slug",
 *   permissions: "grants",
 *   inherits: "parents",
 * });
 * const rbac = createRbacEvaluator({ roles: adapt(await fetchRoles()) });
 */
export function createRolesAdapter(
  mapping: RolesMapping,
): Adapter<Record<string, RoleDefinition>> {
  const list =
    mapping?.list === undefined ? undefined : compilePath(mapping.list, "list");
  const name = compilePath(mapping?.name, "name");
  const permissions = compilePath(mapping?.permissions, "permissions");
  const inherits =
    mapping.inherits === undefined
      ? undefined
      : compilePath(mapping.inherits, "inherits");

  return (response) => {
    const roles: Record<string, RoleDefinition> = {};
    readList(response, list, "roles").forEach((record, index) => {
      const roleName = toIdentifier(readPath(record, name));
      if (roleName === undefined) {
        throw new AdapterMappingError(
          `roles: record ${index} has no usable name.`,
          {
            code: "ADAPTER_ROLE_NAME_MISSING",
            params: {
              index,
            },
          },
        );
      }
      if (roleName === "__proto__") {
        // Assigning this key would replace the object's prototype instead of adding a role.
        throw new AdapterMappingError(
          `roles: record ${index} has an unsafe name.`,
          {
            code: "ADAPTER_ROLE_NAME_UNSAFE",
            params: {
              index,
            },
          },
        );
      }
      if (Object.hasOwn(roles, roleName)) {
        throw new AdapterMappingError(
          `roles: duplicate role at record ${index}.`,
          {
            code: "ADAPTER_ROLE_DUPLICATE",
            params: {
              index,
            },
          },
        );
      }
      const granted = readStringList(
        readPath(record, permissions),
        "permissions",
        index,
      );
      if (granted === undefined) {
        throw new AdapterMappingError(
          `roles: record ${index} has no permissions at "${permissions.join(".")}".`,
          {
            code: "ADAPTER_PERMISSIONS_MISSING",
            params: {
              index,
              path: permissions.join("."),
            },
          },
        );
      }
      const parents =
        inherits === undefined
          ? undefined
          : readStringList(readPath(record, inherits), "inherits", index);
      roles[roleName] = {
        permissions: granted,
        ...(parents === undefined
          ? {}
          : {
              inherits: parents,
            }),
      };
    });
    return roles;
  };
}
