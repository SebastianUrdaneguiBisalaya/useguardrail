import { InvalidPolicyError } from "../errors.js";
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

const parsePermission = (permission: unknown, role: string): Permission => {
  if (typeof permission !== "string") {
    throw new InvalidPolicyError(`Role "${role}" has a non-string permission.`);
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
      `Role "${role}" has invalid permission "${permission}"; expected "<resource>:<action>" or "*".`,
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
    );
  }

  const definitions = new Map<string, RoleDefinition>();
  for (const [name, definition] of Object.entries(rawRoles)) {
    const candidate = definition as Partial<RoleDefinition> | null;
    if (typeof candidate !== "object" || candidate === null) {
      throw new InvalidPolicyError(`Role "${name}" must be an object.`);
    }
    if (!isStringArray(candidate.permissions)) {
      throw new InvalidPolicyError(
        `Role "${name}" requires \`permissions\` to be an array of strings.`,
      );
    }
    if (
      candidate.inherits !== undefined &&
      !isStringArray(candidate.inherits)
    ) {
      throw new InvalidPolicyError(
        `Role "${name}" requires \`inherits\` to be an array of strings.`,
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
      );
    }
    const definition = definitions.get(name);
    if (!definition) {
      throw new InvalidPolicyError(
        `Role "${path[path.length - 1]}" inherits unknown role "${name}".`,
      );
    }
    const permissions = definition.permissions.map((permission) =>
      parsePermission(permission, name),
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
    for (const role of subject.roles ?? []) {
      const permissions = resolved.get(role);
      const granted = permissions?.some(
        (permission) =>
          (permission.resource === "*" ||
            permission.resource === resource.type) &&
          (permission.action === "*" || permission.action === action),
      );
      if (granted) {
        return {
          effect: "allow",
          reason: `Role "${role}" grants "${resource.type}:${action}".`,
        };
      }
    }
    return undefined;
  };
}
