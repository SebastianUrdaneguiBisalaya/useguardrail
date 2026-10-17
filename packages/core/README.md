# @useguardril/core

Framework-independent authorization engine for the frontend: **RBAC**, **ABAC**, and **ReBAC** behind one evaluation API, plus a small reactive store. Zero runtime dependencies; runs in the browser and in Node.

> **Client-side authorization is UX, not security.** Use this package to decide what to show, enable, or route to. Your backend must always re-enforce every decision. This package holds no secrets and never calls a server.

## Installation

```bash
pnpm add -E @useguardril/core
```

Works with `import` (ESM) and `require` (CJS), with bundled types.

## How it works

You build **evaluators** (one per authorization model), hand them to an **engine**, and ask it questions. The engine combines their answers:

| Situation | Result |
|---|---|
| Any evaluator denies | `deny` (deny always wins) |
| At least one allows and none deny | `allow` |
| No evaluator has an opinion | `deny` (default deny) |
| An evaluator throws or returns garbage | `deny` (fails closed) |

`evaluate` is synchronous and never throws.

```ts
import { createEngine, createRbacEvaluator } from "@useguardril/core";

const rbac = createRbacEvaluator({
  roles: {
    viewer: { permissions: ["invoice:read"] },
    editor: { permissions: ["invoice:update"], inherits: ["viewer"] },
  },
});

const engine = createEngine({ evaluators: [rbac] });

const decision = engine.evaluate({
  subject: { id: "user:ana", roles: ["editor"] },
  action: "update",
  resource: { type: "invoice", id: "42" },
  context: { tenantId: "acme" },
});
// { effect: "allow", reason: 'Role "editor" grants "invoice:update".' }
```

## Evaluators

### RBAC: `createRbacEvaluator`

Permissions are `"<resourceType>:<action>"`; either side may be `"*"`, and `"*"` alone grants everything. Roles can inherit from other roles (cycles are rejected). RBAC only grants; it never denies.

### ABAC: `createAbacEvaluator`

Policies with `allow`/`deny` effects, optional `actions` and `resources` scopes, and conditions that must all hold. A `field` is a dot path starting at `subject`, `action`, `resource`, or `context`; compare it with a literal `value` or another field through `valueFrom`.

```ts
import { createAbacEvaluator } from "@useguardril/core";

const abac = createAbacEvaluator({
  policies: [
    {
      id: "same-department",
      effect: "allow",
      actions: ["read"],
      conditions: [
        { field: "subject.attributes.department", op: "eq", valueFrom: "resource.attributes.department" },
      ],
    },
    {
      id: "closed-is-read-only",
      effect: "deny",
      actions: ["update"],
      conditions: [{ field: "resource.attributes.status", op: "eq", value: "closed" }],
    },
  ],
});
```

Operators: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`. If either side of a comparison is missing, the condition does not hold. Paths only read own properties, so the prototype chain is unreachable.

### ReBAC: `createRelationGraph` + `createRebacEvaluator`

Facts are tuples `{ object, relation, subject }`. Subjects may be usersets (`"team:eng#member"`). Rules add implied relations and inheritance through links such as `parent`. Traversal is cycle-safe and depth-limited (`maxDepth`, 16 by default; deeper paths count as not related).

```ts
import { createRebacEvaluator, createRelationGraph } from "@useguardril/core";

const graph = createRelationGraph({
  tuples: [
    { object: "folder:1", relation: "viewer", subject: "team:eng#member" },
    { object: "team:eng", relation: "member", subject: "user:ana" },
    { object: "doc:1", relation: "parent", subject: "folder:1" },
  ],
  rules: {
    viewer: { impliedBy: ["editor"], inheritFrom: [{ via: "parent", relation: "viewer" }] },
  },
});

const rebac = createRebacEvaluator({
  graph,
  requirements: { doc: { read: "viewer", update: "editor" } },
});
```

The subject reference is `subject.id`; the resource reference is `"<type>:<id>"`. Both must match the references used in your tuples. The graph is immutable: when relations change, build a new graph and swap the engine (see below).

## Context and multi-tenancy

Tenancy is always explicit, carried in `context`, never in module-level state. `createContext` validates and freezes it. The graph does not isolate tenants by itself: put the tenant in your references (`"acme/doc:1"`) or use one graph per tenant.

## Reactive store

`createAuthorizationStore` couples an engine with the current subject and context. It exposes `subscribe` and `getSnapshot`, so it works directly with React's `useSyncExternalStore`.

```ts
import { createAuthorizationStore } from "@useguardril/core";

const store = createAuthorizationStore({
  engine,
  subject: { id: "user:ana", roles: ["editor"] },
  context: { tenantId: "acme" },
});

store.can("update", { type: "invoice", id: "42" }); // true

// Only runs when this specific answer changes:
store.subscribeSelector(
  () => store.can("update", { type: "invoice", id: "42" }),
  (allowed) => toggleEditButton(allowed),
);

store.setContext({ tenantId: "other" }); // subscribers are notified
store.setEngine(newEngine); // after policies or relations change
store.setSubject(undefined); // signed out: everything is denied
```

`createStore` is also exported if you need a plain reactive store.

## Error handling

Configuration errors are thrown when you create an engine, evaluator, graph, or store, never while evaluating. Every error extends `AuthorizationError`, so `instanceof` works:

```ts
import { AuthorizationError, InvalidContextError, InvalidPolicyError } from "@useguardril/core";

try {
  createAbacEvaluator({ policies: [{ id: "x", effect: "allow", conditions: [{ field: "nope", op: "eq", value: 1 }] }] });
} catch (error) {
  if (error instanceof InvalidPolicyError) {
    // malformed policy: fix the configuration
  } else if (error instanceof InvalidContextError) {
    // malformed subject or context
  } else if (error instanceof AuthorizationError) {
    // any other error from this package
  }
}
```

## License

[ISC](../../LICENSE)
