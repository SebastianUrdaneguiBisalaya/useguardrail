import { InvalidPolicyError } from "../errors.js";
import { ownProperty } from "../own.js";
import type { Evaluator } from "../types/index.js";

/** A role and the permissions it grants. */
export type RoleDefinition = {
  /**
   * Permissions as `"<resourceType>:<action>"`. Either side may be `"*"`
   * (e.g. `"invoice:*"`, `"*:read"`), and `"*"` alone grants everything.
   */
  readonly permissions: readonly string[];
  /** Names of other roles whose permissions this role also receives. */
  readonly inherits?: readonly string[];
};

/** Configuration for {@link createRbacEvaluator}. */
export type RbacConfig = {
  /** Role definitions keyed by role name. */
  readonly roles: Readonly<Record<string, RoleDefinition>>;
};

type Permission = {
  readonly resource: string;
  readonly action: string;
};

const parsePermission = (
  permission: unknown,
  role: string,
  index: number,
): Permission => {
  if (typeof permission !== "string") {
    throw new InvalidPolicyError(
      `Role "${role}" has a non-string permission at index ${index}.`,
      {
        code: "PERMISSION_NOT_STRING",
        params: {
          index,
          role,
        },
      },
    );
  }
  if (permission === "*") {
    return {
      action: "*",
      resource: "*",
    };
  }
  const separator = permission.indexOf(":");
  if (separator <= 0 || separator === permission.length - 1) {
    throw new InvalidPolicyError(
      `Role "${role}" has an invalid permission at index ${index}; expected "<resource>:<action>" or "*".`,
      {
        code: "PERMISSION_FORMAT_INVALID",
        params: {
          index,
          role,
        },
      },
    );
  }
  return {
    action: permission.slice(separator + 1),
    resource: permission.slice(0, separator),
  };
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Creates an RBAC evaluator. It only ever grants: it returns `allow` when one of the
 * subject's roles (directly or through inheritance) carries a matching permission,
 * and has no opinion otherwise. Unknown roles on the subject are ignored.
 *
 * @throws {InvalidPolicyError} On malformed permissions, unknown inherited roles, or inheritance cycles.
 *
 * @example
 * const rbac = createRbacEvaluator({
 *   roles: {
 *     viewer: { permissions: ["invoice:read"] },
 *     editor: { permissions: ["invoice:update"], inherits: ["viewer"] },
 *   },
 * });
 */
export function createRbacEvaluator(config: RbacConfig): Evaluator {
  const rawRoles: unknown = config?.roles;
  if (
    typeof rawRoles !== "object" ||
    rawRoles === null ||
    Array.isArray(rawRoles)
  ) {
    throw new InvalidPolicyError(
      "RBAC config requires `roles` to be an object.",
      {
        code: "RBAC_ROLES_INVALID",
      },
    );
  }

  const definitions = new Map<string, RoleDefinition>();
  for (const [name, definition] of Object.entries(rawRoles)) {
    const candidate = definition as Partial<RoleDefinition> | null;
    if (typeof candidate !== "object" || candidate === null) {
      throw new InvalidPolicyError(`Role "${name}" must be an object.`, {
        code: "ROLE_NOT_OBJECT",
        params: {
          role: name,
        },
      });
    }
    if (!isStringArray(candidate.permissions)) {
      throw new InvalidPolicyError(
        `Role "${name}" requires \`permissions\` to be an array of strings.`,
        {
          code: "ROLE_PERMISSIONS_INVALID",
          params: {
            role: name,
          },
        },
      );
    }
    if (
      candidate.inherits !== undefined &&
      !isStringArray(candidate.inherits)
    ) {
      throw new InvalidPolicyError(
        `Role "${name}" requires \`inherits\` to be an array of strings.`,
        {
          code: "ROLE_INHERITS_INVALID",
          params: {
            role: name,
          },
        },
      );
    }
    definitions.set(name, candidate as RoleDefinition);
  }

  const resolved = new Map<string, readonly Permission[]>();
  const resolve = (
    name: string,
    path: readonly string[],
  ): readonly Permission[] => {
    const cached = resolved.get(name);
    if (cached) {
      return cached;
    }
    if (path.includes(name)) {
      throw new InvalidPolicyError(
        `Role inheritance cycle: ${[
          ...path,
          name,
        ].join(" -> ")}.`,
        {
          code: "ROLE_INHERITANCE_CYCLE",
          params: {
            cycle: [
              ...path,
              name,
            ],
          },
        },
      );
    }
    const definition = definitions.get(name);
    if (!definition) {
      throw new InvalidPolicyError(
        `Role "${path[path.length - 1]}" inherits unknown role "${name}".`,
        {
          code: "ROLE_INHERITS_UNKNOWN",
          params: {
            inherited: name,
            role: path[path.length - 1] ?? "",
          },
        },
      );
    }
    const permissions = definition.permissions.map((permission, index) =>
      parsePermission(permission, name, index),
    );
    for (const parent of definition.inherits ?? []) {
      permissions.push(
        ...resolve(parent, [
          ...path,
          name,
        ]),
      );
    }
    const frozen = Object.freeze(permissions);
    resolved.set(name, frozen);
    return frozen;
  };

  for (const name of definitions.keys()) {
    resolve(name, []);
  }

  return ({ action, resource, subject }) => {
    const assigned = ownProperty(subject, "roles");
    for (const role of (Array.isArray(assigned)
      ? assigned
      : []) as readonly string[]) {
      const permissions = resolved.get(role);
      const granted = permissions?.some(
        (permission) =>
          (permission.resource === "*" ||
            permission.resource === resource.type) &&
          (permission.action === "*" || permission.action === action),
      );
      if (granted) {
        return {
          code: "ROLE_GRANTS",
          effect: "allow",
          params: {
            action,
            resource: resource.type,
            role,
          },
          reason: `Role "${role}" grants "${resource.type}:${action}".`,
        };
      }
    }
    return undefined;
  };
}
