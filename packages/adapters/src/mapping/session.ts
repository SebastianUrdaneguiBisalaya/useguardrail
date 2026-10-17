import type { Attributes, Context, Subject } from "@useguardril/core";
import { AdapterMappingError } from "@useguardril/core";
import type { Path } from "./path.js";
import { compilePath, readPath, toIdentifier } from "./path.js";
import type { Adapter } from "./types.js";

/** Where to find each field of a "who am I" response, as dot paths. */
export type SessionMapping = {
  /** Path to the user id (string or number). Required. */
  readonly subjectId: string;
  /** Path to the user's roles: an array of strings, or of objects (see `roleKey`). */
  readonly roles?: string;
  /** When roles are objects, the property holding the role name (e.g. `"name"`). */
  readonly roleKey?: string;
  /** Subject attributes: attribute name -> path. Missing or null values are skipped. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Path to the tenant id. When set, it must resolve, so tenant isolation never silently drops. */
  readonly tenantId?: string;
  /** Context attributes: attribute name -> path. Missing or null values are skipped. */
  readonly contextAttributes?: Readonly<Record<string, string>>;
};

/** The subject and context extracted from a session response. */
export type Session = {
  readonly subject: Subject;
  readonly context: Context;
};

const compileAttributes = (
  mapping: Readonly<Record<string, string>> | undefined,
  label: string,
): readonly (readonly [
  string,
  Path,
])[] => {
  if (mapping === undefined) {
    return [];
  }
  if (typeof mapping !== "object" || mapping === null) {
    throw new AdapterMappingError(
      `${label}: expected an object of name -> path.`,
      {
        code: "ADAPTER_ATTRIBUTES_INVALID",
        params: {
          option: label,
        },
      },
    );
  }
  return Object.entries(mapping).map(([name, path]) => [
    name,
    compilePath(path, `${label}.${name}`),
  ]);
};

const pickAttributes = (
  response: unknown,
  compiled: readonly (readonly [
    string,
    Path,
  ])[],
): Attributes | undefined => {
  const picked: Record<string, unknown> = {};
  for (const [name, path] of compiled) {
    const value = readPath(response, path);
    if (value !== undefined && value !== null) {
      picked[name] = value;
    }
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
};

/**
 * Creates an adapter that turns a session/profile response into a `Subject` and `Context`
 * using configurable paths, so it fits any backend's JSON shape.
 *
 * @throws {AdapterMappingError} At creation for invalid paths, and when adapting if the
 * user id (or a configured tenant id) is missing, or roles are not in the expected shape.
 *
 * @example
 * const adapt = createSessionAdapter({
 *   subjectId: "user.id",
 *   roles: "user.roles",
 *   tenantId: "organization.id",
 *   attributes: { department: "user.department" },
 * });
 * const { subject, context } = adapt(await fetchMe());
 */
export function createSessionAdapter(
  mapping: SessionMapping,
): Adapter<Session> {
  const subjectId = compilePath(mapping?.subjectId, "subjectId");
  const roles =
    mapping.roles === undefined
      ? undefined
      : compilePath(mapping.roles, "roles");
  const roleKey =
    mapping.roleKey === undefined
      ? undefined
      : compilePath(mapping.roleKey, "roleKey");
  const tenantId =
    mapping.tenantId === undefined
      ? undefined
      : compilePath(mapping.tenantId, "tenantId");
  const subjectAttributes = compileAttributes(mapping.attributes, "attributes");
  const contextAttributes = compileAttributes(
    mapping.contextAttributes,
    "contextAttributes",
  );

  return (response) => {
    const id = toIdentifier(readPath(response, subjectId));
    if (id === undefined) {
      throw new AdapterMappingError(
        `subjectId: expected a non-empty string or number at "${subjectId.join(".")}".`,
        {
          code: "ADAPTER_SUBJECT_ID_MISSING",
          params: {
            path: subjectId.join("."),
          },
        },
      );
    }

    let roleNames: string[] | undefined;
    if (roles !== undefined) {
      const raw = readPath(response, roles);
      if (raw !== undefined && raw !== null) {
        if (!Array.isArray(raw)) {
          throw new AdapterMappingError(
            `roles: expected an array at "${roles.join(".")}".`,
            {
              code: "ADAPTER_ROLES_NOT_ARRAY",
              params: {
                path: roles.join("."),
              },
            },
          );
        }
        roleNames = raw.map((entry, index) => {
          const name = toIdentifier(
            roleKey === undefined ? entry : readPath(entry, roleKey),
          );
          if (name === undefined) {
            throw new AdapterMappingError(
              `roles: entry ${index} has no usable role name.`,
              {
                code: "ADAPTER_ROLE_NAME_MISSING",
                params: {
                  index,
                },
              },
            );
          }
          return name;
        });
      }
    }

    let tenant: string | undefined;
    if (tenantId !== undefined) {
      tenant = toIdentifier(readPath(response, tenantId));
      if (tenant === undefined) {
        throw new AdapterMappingError(
          `tenantId: expected a non-empty string or number at "${tenantId.join(".")}".`,
          {
            code: "ADAPTER_TENANT_ID_MISSING",
            params: {
              path: tenantId.join("."),
            },
          },
        );
      }
    }

    const attributes = pickAttributes(response, subjectAttributes);
    const contextExtras = pickAttributes(response, contextAttributes);

    return {
      context: {
        ...(tenant === undefined
          ? {}
          : {
              tenantId: tenant,
            }),
        ...(contextExtras === undefined
          ? {}
          : {
              attributes: contextExtras,
            }),
      },
      subject: {
        id,
        ...(roleNames === undefined
          ? {}
          : {
              roles: roleNames,
            }),
        ...(attributes === undefined
          ? {}
          : {
              attributes,
            }),
      },
    };
  };
}
