import type { RoleDefinition } from "@useguardril/core";
import { AdapterMappingError } from "@useguardril/core";
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
  label: string,
): readonly string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new AdapterMappingError(`${label}: expected an array.`);
  }
  return value.map((item, index) => {
    const text = toIdentifier(item);
    if (text === undefined) {
      throw new AdapterMappingError(
        `${label}: entry ${index} is not a usable string.`,
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
        );
      }
      if (roleName === "__proto__") {
        // Assigning this key would replace the object's prototype instead of adding a role.
        throw new AdapterMappingError(
          `roles: record ${index} has an unsafe name.`,
        );
      }
      if (Object.hasOwn(roles, roleName)) {
        throw new AdapterMappingError(
          `roles: duplicate role at record ${index}.`,
        );
      }
      const granted = readStringList(
        readPath(record, permissions),
        `roles: record ${index} permissions`,
      );
      if (granted === undefined) {
        throw new AdapterMappingError(
          `roles: record ${index} has no permissions at "${permissions.join(".")}".`,
        );
      }
      const parents =
        inherits === undefined
          ? undefined
          : readStringList(
              readPath(record, inherits),
              `roles: record ${index} inherits`,
            );
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
