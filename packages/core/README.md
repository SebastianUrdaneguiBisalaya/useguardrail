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

Policies with `allow`/`deny` effects, optional `actions` and `resources` scopes, and `conditions`. The policy's top-level `conditions` must all hold (AND); use `any` and `not` inside them for OR and NOT. A `field` is a dot path starting at `subject`, `action`, `resource`, or `context`; compare it with a literal `value` or another field through `valueFrom`.

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

#### Combining conditions: `all`, `any`, `not`

A condition is either a field comparison or a group, and groups nest:

| Condition | Holds when |
|---|---|
| `{ field, op, value \| valueFrom }` | The comparison holds. |
| `{ all: [c1, c2, ...] }` | Every child holds (AND). |
| `{ any: [c1, c2, ...] }` | At least one child holds (OR). |
| `{ not: c }` | The child does **not** hold. |

```ts
{
  id: "staff-read-unlocked",
  effect: "allow",
  actions: ["read"],
  conditions: [
    // (department is sales OR support) AND NOT locked
    {
      all: [
        { any: [
          { field: "subject.attributes.department", op: "eq", value: "sales" },
          { field: "subject.attributes.department", op: "eq", value: "support" },
        ] },
        { not: { field: "resource.attributes.locked", op: "eq", value: true } },
      ],
    },
  ],
}
```

- `all` and `any` need a **non-empty** array (an empty one is rejected, so it can never mean "always true" by accident). A node must be exactly one of a comparison, `all`, `any`, or `not`.
- **Nesting is limited to `MAX_CONDITION_DEPTH` (8) levels**; deeper conditions are rejected when the evaluator is created.
- **`not` and missing values:** a comparison that fails only because a value is missing becomes true under `not`, so `{ not: { field: "subject.attributes.role", op: "eq", value: "guest" } }` is also true for a subject with no `role`. Prefer positive conditions in `allow` policies, and express exclusions as `deny` policies.
- The decision is unchanged: a matching `deny` policy still wins, and the decision `code` is still `POLICY_ALLOWS` / `POLICY_DENIES` with the `policyId`. `engine.explain` shows which policy decided.

### ReBAC: `createRelationGraph` + `createRebacEvaluator`

Facts are tuples `{ object, relation, subject }`. Subjects may be usersets (`"team:eng#member"`) or wildcards (`"user:*"`). Rules add implied relations and inheritance through links such as `parent`. Traversal is cycle-safe and depth-limited (`maxDepth`, 16 by default; deeper paths count as not related).

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

#### Wildcard subjects (public access)

A tuple whose subject is `"<type>:*"` grants the relation to **every subject whose reference starts with `<type>:`**:

```ts
import { createRelationGraph } from "@useguardril/core";

const graph = createRelationGraph({
  tuples: [{ object: "doc:handbook", relation: "viewer", subject: "user:*" }],
});

graph.check("user:ana", "viewer", "doc:handbook"); // true: any "user:..."
graph.check("bot:r2", "viewer", "doc:handbook"); // false: different type
```

- It matches by the whole type prefix (`user:`), so `username:ana` is not covered.
- It works with implied relations and inheritance, and as a member inside a userset (`team:eng` has `member` `user:*`), but a wildcard **cannot be the userset itself** (`"team:*#member"` is rejected with `TUPLE_REFERENCE_INVALID`), and `":*"` with no type is rejected too.
- A bare `*` is just an ordinary reference, not a wildcard.
- Wildcards grant to anyone who is signed in with that type of reference; a signed-out store is still denied (`NO_SUBJECT`).

#### Per-tenant graphs: `createTenantRelationGraph`

For multi-tenant apps, give each tenant its own graph so a relation in one tenant can never grant access in another, even when their references look alike:

```ts
import { createRebacEvaluator, createTenantRelationGraph } from "@useguardril/core";

const graph = createTenantRelationGraph({
  tuples: {
    acme: [{ object: "doc:1", relation: "viewer", subject: "user:ana" }],
    globex: [{ object: "doc:1", relation: "viewer", subject: "user:bob" }],
  },
  rules, // optional, shared by every tenant
});

const rebac = createRebacEvaluator({ graph, requirements: { doc: { read: "viewer" } } });
// The evaluator picks the graph by context.tenantId:
//   context { tenantId: "acme" }   -> only acme's tuples are consulted
//   no tenantId, or an unknown one -> no opinion, so the result is deny
```

`graph.forTenant(id)` returns that tenant's `RelationGraph` (or `undefined`), `graph.check(tenantId, subject, relation, object)` is the shortcut, and `graph.tenants()` lists the ids. When a tenant's tuples are invalid, the error names the tenant (`params.tenantId`). Switch tenants with `store.setContext({ tenantId })`.

## Context and multi-tenancy

Tenancy is always explicit, carried in `context`, never in module-level state. `createContext` validates and freezes it. A plain relation graph does not isolate tenants by itself: use `createTenantRelationGraph` (see the ReBAC section) so each tenant gets its own graph.

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

Two helpers exist for UI adapters and server rendering:

- `store.getInitialSnapshot()` returns the state the store was **created** with; it never changes. React uses it as the server snapshot so server rendering and hydration agree.
- `evaluateState(state, action, resource)` is the pure function behind `store.evaluate`: it evaluates against any state you pass in (for example `store.getInitialSnapshot()`) without touching the store. It never throws.

## Debugging and auditing

`engine.explain(input)` and `store.explain(action, resource)` return the decision together with a per-evaluator `trace` (and, for the store, the `status` and subject it ran in), so you can find out why something was denied. `onDecision` on `createEngine` and `createAuthorizationStore` receives the same event after every evaluation; the library never logs on its own.

```ts
import { createEngine } from "@useguardril/core";

const engine = createEngine({
  evaluators,
  // Called after every evaluation. Never able to change the decision.
  onDecision: ({ input, decision }) => audit.push([input.action, decision.code]),
});

const { decision, trace } = engine.explain({ subject, action: "update", resource, context });
trace.forEach(({ index, outcome }) => console.log(index, outcome)); // 0 "abstain", 1 "deny", ...
```

| Export | Purpose |
|---|---|
| `Engine["explain"]` | Evaluates and returns a `DecisionEvent` (`{ input, decision, trace }`). |
| `AuthorizationStore["explain"]` | Evaluates and returns a `StoreDecisionEvent` (`{ action, resource, subject, context, status, decision, trace }`). |
| `EvaluatorTrace`, `EvaluatorOutcome` | One trace entry: `{ index, outcome, decision?, error? }`, where `outcome` is `"allow" \| "deny" \| "abstain" \| "threw" \| "malformed"`. |
| `onDecision` | Optional hook on the engine and on the store. Cannot change the decision; its errors are rethrown asynchronously. |

Evaluation stops at the first evaluator that denies, throws, or misbehaves, so later ones are not in the trace. Events hold the full request (attributes included); redact before sending them anywhere. See the [root README](../../README.md#debugging-and-auditing) for the full guide and caveats.

## Typed schema (actions and resources)

Declare which actions each resource type supports and the compiler checks every permission, policy scope, relation requirement, and `can(...)` call:

```ts
import { forSchema } from "@useguardril/core";

type AppSchema = {
  invoice: "read" | "update" | "delete";
  user: "read" | "invite";
};

const auth = forSchema<AppSchema>();
// auth.createEngine, createRbacEvaluator, createAbacEvaluator, createRebacEvaluator,
// createAuthorizationStore: the same functions, with your schema applied to their types.
```

| Export | Purpose |
|---|---|
| `Schema` | The constraint a schema must satisfy: `Readonly<Record<string, string>>`. Declare yours with `type`, not `interface`. |
| `forSchema<S>()` | Binds all factories to `S` in one place. |
| `ResourceName<S>`, `ActionName<S>` | The resource types / all actions of a schema. |
| `ResourceFor<T>` | A resource of type `T`: `{ type: T; id?; attributes? }`. |
| `PermissionString<S>` | The permission strings valid for `S` (`"*"`, `"invoice:update"`, `"invoice:*"`, `"*:read"`, ...). |
| `Engine<S>`, `Evaluator<S>`, `EvaluationInput<S>`, `AuthorizationStore<S>` | Schema-aware versions of the core types. Every one defaults to the loose schema (any string). |

You can also pass the schema to each factory (`createEngine<AppSchema>({...})`), or let TypeScript infer it from a typed evaluator or engine. A schema-less evaluator is accepted next to typed ones (useful for roles loaded through an adapter, whose permissions are plain strings); a schema-bound evaluator is not accepted by an engine without that schema.

The schema is **compile-time only**: nothing changes at runtime, and plain JavaScript callers are still validated. See the [root README](../../README.md#typed-actions-and-resources) for a full example and what is checked where.

## Loading state (async data)

Evaluation is always **synchronous**. What is asynchronous is getting the data (the session, roles, tuples) from your backend. The store models that with a `status`:

| Status | Meaning | `can()` / `evaluate()` |
|---|---|---|
| `"ready"` | Data is usable. A missing subject means signed out. | Normal result (`NO_SUBJECT` when signed out). |
| `"loading"` | Data is still on its way. | Always `deny`, code `LOADING`. |
| `"error"` | Loading failed. | Always `deny`, code `LOAD_FAILED`. |

Without this, a store created before the session arrives would answer "no access" and the UI would flash a denial, then flip to allowed. Start in `"loading"` instead and let `load` fill the store:

```ts
import { createAuthorizationStore } from "@useguardril/core";

const store = createAuthorizationStore({ engine, status: "loading" });

await store.load(async ({ signal }) => {
  const me = await fetch("/api/me", { signal }).then((r) => r.json());
  return {
    subject: { id: me.id, roles: me.roles },
    context: { tenantId: me.organizationId },
  };
}); // never rejects

store.getSnapshot().status; // "ready", or "error" (with the cause in .error)
```

- **Atomic.** The result's `subject`, `context`, and `engine` are applied together, and the status flips to `"ready"` in the same step, so there is never a half-updated state.
- **Only present fields apply.** Omit a field to keep its current value; pass `subject: undefined` to sign out.
- **Never rejects.** A loader that throws, or returns invalid data, leaves the store in `"error"` (`store.getSnapshot().error` holds the cause). A later successful `load` recovers.
- **Stale loads are ignored.** Calling `load` again aborts the previous one (its `signal` fires, so `fetch` is cancelled) and discards its result, so a slow old response can never overwrite fresh data. Use it for tenant switches and refreshes.
- **Manual control.** `setStatus("loading" | "ready")` and `setError(cause)` exist if you manage the fetching yourself. The other setters (`setSubject`, `setContext`, `setEngine`) never change the status.
- **Default is `"ready"`**, so existing code that builds a store with a subject keeps working unchanged.

## Error handling

Configuration errors are thrown when you create an engine, evaluator, graph, or store, never while evaluating. Every error extends `AuthorizationError`, so `instanceof` works:

```ts
import {
  AuthorizationError,
  createAbacEvaluator,
  InvalidContextError,
  InvalidPolicyError,
} from "@useguardril/core";

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

## Localizing messages

`message` and `reason` are always English. Every error has a stable `code` and `params` (and every built-in decision has `code` and `params` too), so you can show text in your own language. `ERROR_CODES` and `DECISION_CODES` list them all; see the [root README](../../README.md#error-codes-and-localization) for the full tables and an example.

## API reference

Everything `@useguardril/core` exports. Each name links to where it is explained above, or is described here.

**Factories and functions**

| Export | Purpose |
|---|---|
| `createEngine(config)` | Combines evaluators into an `Engine` (`evaluate`, `explain`). |
| `createRbacEvaluator(config)` | Roles, inheritance, `resource:action` permissions. |
| `createAbacEvaluator(config)` | Attribute policies with `all` / `any` / `not` conditions. |
| `createRelationGraph(config)` | Relation tuples, usersets, wildcards, rules. |
| `createTenantRelationGraph(config)` | One isolated relation graph per tenant. |
| `createRebacEvaluator(config)` | Turns a graph plus `requirements` into an evaluator. |
| `createContext(input)` | Validates and freezes an evaluation `Context`. |
| `createAuthorizationStore(config)` | Reactive store: engine + subject + context + status; `can`, `evaluate`, `explain`, `load`, setters. |
| `createStore(initial)` | A plain reactive store (`getSnapshot`, `getInitialSnapshot`, `setState`, `subscribe`, `subscribeSelector`). |
| `evaluateState(state, action, resource)` | Pure evaluation against any store state. |
| `forSchema<S>()` | Binds all factories to a typed `Schema`. |

**Errors and codes**

| Export | Purpose |
|---|---|
| `AuthorizationError` | Base class of every error; has `code` and `params`. |
| `InvalidPolicyError`, `InvalidContextError`, `AdapterMappingError` | Malformed policy / subject or context / backend data (the last one is thrown by `@useguardril/adapters`). |
| `ERROR_CODES`, `DECISION_CODES`, `MAX_CONDITION_DEPTH` | Lists of every stable code, and the ABAC nesting limit. |

**Types**

| Group | Types |
|---|---|
| Request | `Subject`, `Resource`, `ResourceFor<T>`, `Action`, `Attributes`, `Context`, `EvaluationInput<S>` |
| Decisions | `Decision`, `DecisionEffect`, `DecisionCode`, `Evaluator<S>`, `MessageParams`, `ErrorCode`, `ErrorDetails` |
| Engine and debugging | `Engine<S>`, `EngineConfig<S>`, `DecisionEvent<S>`, `EvaluatorTrace`, `EvaluatorOutcome` |
| RBAC | `RbacConfig<S>`, `RoleDefinition<S>`, `PermissionString<S>` |
| ABAC | `AbacConfig<S>`, `AbacPolicy<S>`, `Condition`, `FieldCondition`, `AllCondition`, `AnyCondition`, `NotCondition`, `ConditionOperator` |
| ReBAC | `RelationTuple`, `RelationRule`, `InheritRule`, `RelationGraph`, `RelationGraphConfig`, `TenantRelationGraph`, `TenantRelationGraphConfig`, `RebacConfig<S>`, `RebacRequirements<S>` |
| Store | `AuthorizationStore<S>`, `AuthorizationStoreConfig<S>`, `AuthorizationState<S>`, `AuthorizationStatus`, `AuthorizationLoader<S>`, `AuthorizationLoadResult<S>`, `StoreDecisionEvent<S>`, `Store<T>`, `Listener`, `Unsubscribe` |
| Schema | `Schema`, `ResourceName<S>`, `ActionName<S>`, `SchemaKit<S>` |

## License

[ISC](../../LICENSE)
