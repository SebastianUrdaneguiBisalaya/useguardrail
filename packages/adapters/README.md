# @useguardril/adapters

Adapters that normalize backend responses into the [`@useguardril/core`](../core) contract, so the engine never has to know what your API looks like.

> **Client-side authorization is UX, not security.** Your backend must always re-enforce every decision.

## Installation

```bash
pnpm add -E @useguardril/core @useguardril/adapters
```

## What is an adapter?

An `Adapter<T>` is a pure function `(response: unknown) => T`. It never mutates the response and throws `AdapterMappingError` (from `@useguardril/core`) when the response does not have the expected shape. Error messages name **paths**, never response values, so they are safe to log.

Adapters are configured with dot paths (`"user.profile.id"`). Paths read own properties only and reject `__proto__`, `constructor`, and `prototype`.

## Session: `createSessionAdapter`

Turns a "who am I" response into a `Subject` and a `Context`.

```ts
import { createAuthorizationStore } from "@useguardril/core";
import { createSessionAdapter } from "@useguardril/adapters";

const adaptSession = createSessionAdapter({
  subjectId: "user.id", // string or number
  roles: "user.roles", // array of strings...
  roleKey: "name", // ...or of objects holding the name here
  attributes: { department: "user.department" },
  tenantId: "organization.id",
});

const { subject, context } = adaptSession(await fetchMe());
const store = createAuthorizationStore({ engine, subject, context });
```

The user id is required. If `tenantId` is configured and missing, it throws instead of silently dropping tenant isolation. Missing roles or attributes are simply omitted (least privilege).

## Roles: `createRolesAdapter`

Turns a roles response into the `roles` object for `createRbacEvaluator`.

```ts
import { createRbacEvaluator } from "@useguardril/core";
import { createRolesAdapter } from "@useguardril/adapters";

const adaptRoles = createRolesAdapter({
  list: "data.roles", // omit when the response is the array itself
  name: "slug",
  permissions: "grants", // ["invoice:read", ...]
  inherits: "parents", // optional
});

const rbac = createRbacEvaluator({ roles: adaptRoles(await fetchRoles()) });
```

## Relation tuples

For `createRelationGraph` (ReBAC):

| Adapter | Input |
|---|---|
| `createTuplesAdapter({ list?, object, relation, subject })` | Any backend, via paths. |
| `openFgaTuplesAdapter` | OpenFGA `Read` response (`{ tuples: [{ key: { user, relation, object } }] }`). |
| `spiceDbTuplesAdapter` | SpiceDB `ReadRelationships` output: an array, `{ relationships }`, or streamed `{ result: { relationship } }`. |

```ts
import { createRelationGraph } from "@useguardril/core";
import { openFgaTuplesAdapter } from "@useguardril/adapters";

const graph = createRelationGraph({ tuples: openFgaTuplesAdapter(await readTuples()) });
```

Userset subjects (`"team:eng#member"`) and wildcard subjects (`"user:*"`, public access for every `user:...`) are preserved as written; the core graph understands both.

## Reference

| Export | Purpose |
|---|---|
| `createSessionAdapter(mapping: SessionMapping)` | Session/profile response to `{ subject, context }`. |
| `createRolesAdapter(mapping: RolesMapping)` | Roles response to the `roles` object for `createRbacEvaluator`. |
| `createTuplesAdapter(mapping: TuplesMapping)` | Any relation-record response to `RelationTuple[]`. |
| `openFgaTuplesAdapter`, `spiceDbTuplesAdapter` | Ready-made adapters for OpenFGA and SpiceDB responses. |
| `Adapter<T>` | `(response: unknown) => T`: the shape of every adapter, and of your own. |
| `Session` | What the session adapter returns: `{ subject: Subject; context: Context }`. |

Every adapter throws `AdapterMappingError` (exported by `@useguardril/core`, with a stable `code` and `params`) when the response does not have the expected shape.

## Writing your own

Any function with the right shape is an adapter:

```ts
import { AdapterMappingError } from "@useguardril/core";
import type { RoleDefinition } from "@useguardril/core";
import type { Adapter } from "@useguardril/adapters";

// A legacy API answering { "admin": ["invoice:*"], "viewer": ["invoice:read"] }
const legacyRoles: Adapter<Record<string, RoleDefinition>> = (response) => {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new AdapterMappingError("Expected an object of role -> permissions.");
  }
  const roles: Record<string, RoleDefinition> = {};
  Object.entries(response).forEach(([name, permissions], index) => {
    if (name === "__proto__" || !Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
      // Say where the problem is (the position), not what the backend sent.
      throw new AdapterMappingError(`Role at position ${index} is not a list of permission strings.`);
    }
    roles[name] = { permissions };
  });
  return roles;
};
```

Rules for custom adapters: validate everything, never mutate the response, and keep response values out of error messages (name positions or paths) so errors are safe to log.

## License

[ISC](../../LICENSE)
