# useguardril

A frontend-first, framework-independent authorization SDK for TypeScript. Describe who can do what with **RBAC**, **ABAC**, and **ReBAC**, evaluate it synchronously in the browser or in Node, and keep your UI in sync through a small reactive store.

> **Client-side authorization is UX, not security.** Use it to decide what to show, enable, or route to. Your backend must always re-enforce every decision. These packages hold no secrets and never call a server.

> **Status:** pre-1.0 and not yet published to npm.

## Packages

| Package | Description |
|---|---|
| [`@useguardril/core`](./packages/core) | The engine: RBAC, ABAC, and ReBAC evaluators, multi-tenant context, and a reactive store. No UI dependencies, zero runtime dependencies. |
| [`@useguardril/react`](./packages/react) | React adapter: `AuthorizationProvider`, `useCan`, `<Can>`. Re-renders a component only when its own answer changes. |
| [`@useguardril/adapters`](./packages/adapters) | Normalizes backend responses (sessions, roles, OpenFGA and SpiceDB relation tuples) into the core contract. |

## Why useguardril

- **Three models, one API.** RBAC, ABAC, and ReBAC are pluggable evaluators that compose into a single decision.
- **Safe by default.** Deny always wins, no opinion means deny, and an evaluator that throws or returns garbage also means deny.
- **Framework-independent.** The engine knows nothing about React. The React adapter is a thin layer over a store contract (`subscribe` / `getSnapshot`) that works with `useSyncExternalStore`.
- **Fast.** Microsecond evaluations at realistic sizes (see [Performance](#performance)).
- **Explicit multi-tenancy.** The tenant travels in the evaluation context, never in module-level state.

## Quick start

```bash
pnpm add -E @useguardril/core @useguardril/react
```

```tsx
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
} from "@useguardril/core";
import { AuthorizationProvider, Can, useCan } from "@useguardril/react";

const engine = createEngine({
  evaluators: [
    createRbacEvaluator({
      roles: {
        viewer: { permissions: ["invoice:read"] },
        editor: { permissions: ["invoice:update"], inherits: ["viewer"] },
      },
    }),
  ],
});

const store = createAuthorizationStore({
  engine,
  subject: { id: "user:ana", roles: ["editor"] },
  context: { tenantId: "acme" },
});

function Invoice({ id }: { id: string }) {
  const canEdit = useCan("update", { type: "invoice", id });
  return (
    <>
      <button disabled={!canEdit}>Edit</button>
      <Can action="delete" resource={{ type: "invoice", id }} fallback={<span>Read only</span>}>
        <button>Delete</button>
      </Can>
    </>
  );
}

export const App = () => (
  <AuthorizationProvider store={store}>
    <Invoice id="42" />
  </AuthorizationProvider>
);
```

Not using React? `@useguardril/core` works on its own:

```ts
store.can("update", { type: "invoice", id: "42" }); // true
store.setSubject(undefined); // signed out: everything is denied
```

## How decisions are combined

| Situation | Result |
|---|---|
| Any evaluator denies | `deny` |
| At least one allows and none deny | `allow` |
| No evaluator has an opinion | `deny` (default deny) |
| An evaluator throws or returns a malformed decision | `deny` (fails closed) |

`evaluate` is synchronous and never throws. Misconfiguration (a malformed policy, a role inheritance cycle, an invalid context) throws a typed error when you create the engine, evaluator, or store, never while evaluating.

## Loading state

Evaluation is synchronous; fetching the data is not. Create the store in `"loading"` and fill it with `store.load(...)`, so the UI shows a skeleton instead of flashing "no access" while the session loads:

```tsx
const store = createAuthorizationStore({ engine, status: "loading" });

void store.load(async ({ signal }) => {
  const me = await fetch("/api/me", { signal }).then((r) => r.json());
  return { subject: { id: me.id, roles: me.roles }, context: { tenantId: me.org } };
});

<Can action="update" resource={{ type: "invoice", id }} loading={<Skeleton />} fallback={<ReadOnlyBadge />}>
  <EditButton />
</Can>;
```

| Status | `can()` | React |
|---|---|---|
| `"loading"` | `deny` (`LOADING`) | `<Can loading>` / `useAccess` → `"loading"` |
| `"ready"` | normal | `"allowed"` or `"denied"` |
| `"error"` | `deny` (`LOAD_FAILED`) | `useAuthorizationStatus()` → `"error"`, `useAuthorizationError()` has the cause |

`load` never rejects, applies subject, context, and engine atomically, and ignores stale results when called again (for example on a tenant switch). Details in the [core README](./packages/core/README.md#loading-state-async-data).

## Security model

What the SDK defends against:

- **Hostile data.** Backend or user-supplied JSON cannot reach the prototype chain: field paths read own properties only and reject `__proto__`, `constructor`, and `prototype`; lookups use `Map`s; optional inputs (`roles`, `tenantId`, a resource `id`) are read as own properties, so a polluted `Object.prototype` cannot grant roles or a tenant; there is no `eval`.
- **Mistakes.** Deny wins, no opinion means deny, and failures deny.

What it cannot defend against, by design: **anyone who controls the browser.** A user with devtools, a malicious extension, or an XSS payload can call `store.setSubject({ id: "x", roles: ["admin"] })`, patch built-in functions, or edit the bundle, and no client-side library can stop that. It is also why the backend must re-check every action. Treat `can()` as "should I show this?", never as "may this happen?".

Pass plain data objects (not class instances with prototype getters) as subjects, resources, and contexts.

## Limits and edge behavior

Rule of thumb: **mistakes in configuration throw when you create the engine, evaluator, graph, store, or adapter. Nothing throws while evaluating**; a limit reached at evaluation time results in `deny` or "no opinion", never an exception.

### Limits that deny instead of throwing

| Limit | Value | What happens when reached |
|---|---|---|
| ReBAC traversal depth (`maxDepth` in `createRelationGraph`) | 16 by default; any positive integer | Deeper paths count as "not related", so access is denied. Raise `maxDepth` if your hierarchies are legitimately deeper. |
| ReBAC cycles in tuples, usersets, or rules | none | Safe: each `(object, relation)` is visited once per check, so the traversal ends and denies. No error. |
| ABAC scope index cache | 1,024 `(action, resource type)` pairs per evaluator | The cache is cleared and rebuilt. Only affects speed, never decisions. |
| ABAC condition values that are missing | — | The condition does not hold. A missing field never matches, not even `neq`. |
| ABAC `gt` / `gte` / `lt` / `lte` | number vs number, or string vs string | Any other combination does not hold. |
| ABAC conditions inside one policy | AND only | There is no OR inside a policy; write several policies instead (any matching `allow` grants, any matching `deny` wins). |
| ReBAC resource without an `id`, or an action with no requirement | — | The evaluator has no opinion, so the result is `deny` unless another evaluator allows. |
| An evaluator that throws, or returns a malformed decision | — | `deny`. The error detail is not exposed in the decision. |
| ReBAC wildcard subjects (such as OpenFGA's `user:*`) | not supported | Kept as written and match nobody. |
| Evaluation | synchronous only | There is no async evaluator. Fetch data with `store.load(...)` (see [Loading state](#loading-state)); until it arrives, every check is denied with code `LOADING`. |
| A loader that throws or returns invalid data | — | The store goes to `"error"` and denies everything (`LOAD_FAILED`); `load` itself never rejects. |
| A newer `store.load(...)` while one is running | — | The older load is aborted and its result ignored. |

### Limits that throw (at creation time)

| Limit | Value | Error |
|---|---|---|
| Role inheritance cycle, or inheriting an unknown role | none allowed | `InvalidPolicyError` |
| RBAC permission format | `"<resource>:<action>"` or `"*"` | `InvalidPolicyError` |
| Policy `id` | non-empty and unique | `InvalidPolicyError` |
| ABAC operators | `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists` | `InvalidPolicyError` |
| ABAC field paths | start with `subject`, `action`, `resource`, or `context`; no empty segments; `__proto__`, `constructor`, and `prototype` rejected | `InvalidPolicyError` |
| Relation tuples | non-empty `object`, `relation`, `subject`; `#` only once in a subject (`"team:eng#member"`) | `InvalidPolicyError` |
| `maxDepth` | a positive integer | `InvalidPolicyError` |
| Subject | a non-empty string `id` | `InvalidContextError` |
| Context | `tenantId` a non-empty string, `attributes` a plain object | `InvalidContextError` |
| Adapter paths | non-empty dot paths, same forbidden segments as above | `AdapterMappingError` |
| Adapter input | a usable user id; a tenant id when `tenantId` is configured; roles and permissions in the expected shape; no duplicate role names; no role named `__proto__` | `AdapterMappingError` |
| React hooks and `<Can>` | must be inside an `AuthorizationProvider` | `MissingProviderError` |

All of these extend `AuthorizationError`, so one `instanceof` check catches them. Other things to know:

- **Graphs and engines are immutable.** When roles, policies, or tuples change, build a new one and call `store.setEngine(...)`.
- **A listener that throws** does not stop the others; its error is rethrown asynchronously so it still surfaces as an unhandled error.
- **Error messages and `params` carry identifiers and positions only** (role names, policy ids, paths, indexes), never user ids, tuple values, or other backend response data, so they are safe to log.

## Error codes and localization

`message` (on errors) and `reason` (on decisions) are always in English. For any other language, use the stable `code` and `params` that come with every error and every built-in decision, and format the text yourself, with your own i18n library or a plain object:

```ts
import { AuthorizationError, ERROR_CODES, type ErrorCode } from "@useguardril/core";

const es: Partial<Record<ErrorCode, (p: Record<string, unknown>) => string>> = {
  ROLE_INHERITANCE_CYCLE: (p) => `Ciclo de herencia de roles: ${(p.cycle as string[]).join(" -> ")}.`,
  PROVIDER_MISSING: () => "Falta el <AuthorizationProvider> en el árbol.",
};

try {
  createRbacEvaluator({ roles });
} catch (error) {
  if (error instanceof AuthorizationError) {
    const text = es[error.code]?.(error.params) ?? error.message; // fall back to English
    showToast(text);
  }
}
```

Decisions work the same way:

```ts
const decision = store.evaluate("update", resource);
// decision.code === "ROLE_GRANTS", decision.params === { role: "editor", resource: "invoice", action: "update" }
```

- **Codes are stable.** A code never changes meaning. `ERROR_CODES` and `DECISION_CODES` list every one, and `ErrorCode` is a type, so a typo in your catalog fails to compile.
- **`params` are plain, serializable values** (strings, numbers, booleans, string arrays), and never contain user ids, tuple values, or other response data.
- **The library never logs and has no success messages**, so there is nothing else to translate.
- **Custom evaluators** can set their own `code` and `params` on the decisions they return; the engine passes them through.

### What throws, and where to catch it

- **What throws.** Errors are thrown when you create an engine, evaluator, graph, or store, and they are mostly configuration errors, meant for the developer rather than the end user. Evaluating never throws. To tell a user "you don't have permission", use `decision.code` and `decision.params`.
- **Listener errors.** If a store listener throws, the error is rethrown asynchronously. Catch it with `window.addEventListener("error", ...)`, not with `try/catch`.

### Decision codes

| Code | Params | Meaning |
|---|---|---|
| `ROLE_GRANTS` | `role`, `resource`, `action` | An RBAC role grants the permission. |
| `POLICY_ALLOWS` / `POLICY_DENIES` | `policyId` | An ABAC policy allows or denies. |
| `RELATION_GRANTS` | `relation`, `object` | The subject holds the required relation (ReBAC). |
| `DEFAULT_DENY` | — | No evaluator had an opinion. |
| `EVALUATOR_FAILED` / `EVALUATOR_MALFORMED` | — | An evaluator threw or returned a malformed decision. |
| `NO_SUBJECT` | — | Nobody is signed in (store). |
| `LOADING` | — | The store's data is still loading (store). |
| `LOAD_FAILED` | — | Loading the store's data failed (store). |

### Error codes

| Area | Codes | Params |
|---|---|---|
| Context, subject, engine | `CONTEXT_NOT_OBJECT`, `CONTEXT_TENANT_ID_INVALID`, `CONTEXT_ATTRIBUTES_INVALID`, `SUBJECT_INVALID`, `ENGINE_REQUIRED`, `EVALUATORS_INVALID`, `LOADER_INVALID`, `LOAD_RESULT_INVALID` | — |
| RBAC | `RBAC_ROLES_INVALID` | — |
| | `ROLE_NOT_OBJECT`, `ROLE_PERMISSIONS_INVALID`, `ROLE_INHERITS_INVALID` | `role` |
| | `PERMISSION_NOT_STRING`, `PERMISSION_FORMAT_INVALID` | `role`, `index` |
| | `ROLE_INHERITANCE_CYCLE` | `cycle` |
| | `ROLE_INHERITS_UNKNOWN` | `role`, `inherited` |
| ABAC | `ABAC_POLICIES_INVALID` | — |
| | `POLICY_NOT_OBJECT`, `POLICY_ID_INVALID` | `index` |
| | `POLICY_ID_DUPLICATE`, `POLICY_EFFECT_INVALID`, `POLICY_CONDITIONS_INVALID`, `CONDITION_NOT_OBJECT`, `CONDITION_EXISTS_INVALID`, `CONDITION_VALUE_SOURCE_INVALID` | `policyId` |
| | `POLICY_SCOPE_INVALID` | `policyId`, `option` |
| | `CONDITION_OPERATOR_UNKNOWN`, `CONDITION_ARRAY_REQUIRED` | `policyId`, `operator` |
| | `CONDITION_FIELD_INVALID` | `policyId`, `field` |
| ReBAC | `GRAPH_TUPLES_INVALID`, `GRAPH_RULES_INVALID`, `GRAPH_MAX_DEPTH_INVALID`, `REBAC_GRAPH_REQUIRED`, `REBAC_REQUIREMENTS_INVALID` | — |
| | `TUPLE_NOT_OBJECT`, `TUPLE_FIELDS_INVALID`, `TUPLE_REFERENCE_INVALID` | `index` |
| | `RULE_NOT_OBJECT`, `RULE_IMPLIED_BY_INVALID`, `RULE_INHERIT_FROM_INVALID` | `relation` |
| | `REBAC_REQUIREMENT_TYPE_INVALID` | `resourceType` |
| | `REBAC_REQUIREMENT_INVALID` | `resourceType`, `action` |
| React | `PROVIDER_MISSING` | — |
| Adapters | `ADAPTER_PATH_INVALID`, `ADAPTER_ATTRIBUTES_INVALID` | `option` |
| | `ADAPTER_LIST_NOT_ARRAY` | `option`, `path` (when set) |
| | `ADAPTER_STRING_LIST_INVALID` | `field`, `index`, `entry` (when set) |
| | `ADAPTER_FIELD_MISSING` | `field`, `index` |
| | `ADAPTER_SUBJECT_ID_MISSING`, `ADAPTER_TENANT_ID_MISSING`, `ADAPTER_ROLES_NOT_ARRAY` | `path` |
| | `ADAPTER_ROLE_NAME_MISSING`, `ADAPTER_ROLE_NAME_UNSAFE`, `ADAPTER_ROLE_DUPLICATE` | `index` |
| | `ADAPTER_PERMISSIONS_MISSING` | `index`, `path` |

`AUTHORIZATION_ERROR`, `INVALID_POLICY`, `INVALID_CONTEXT`, and `ADAPTER_MAPPING` are the defaults for errors you create yourself (for example in a custom adapter) without a more specific code.

## Performance

Measured with `vitest bench` on an Apple M2 (Node 24). Each row is the mean time of one operation. "Before" and "after" are the same benchmark run on the code without and with the ABAC scope index, which looks up only the policies whose `actions` and `resources` match the request.

| Scenario | Before | After | Change |
|---|---|---|---|
| ABAC, 1,000 policies spread over 50 resource types × 4 actions | 12.2 µs | 0.4 µs | **~30× faster** |
| ABAC, 1,000 policies, all in scope, none match | 63.7 µs | 53.5 µs | ~1.2× faster |
| Engine: RBAC + ABAC + ReBAC combined (1,000 in-scope ABAC policies) | 79.4 µs | 71.1 µs | ~1.1× faster |
| RBAC, 500-role inheritance chain | 12.5 µs | 12.6 µs | unchanged |
| ReBAC, 12-level parent chain, 5,014 tuples | 3.2 µs | 3.1 µs | unchanged |
| ReBAC, negative lookup walking the whole chain | 3.3 µs | 3.3 µs | unchanged |
| `setContext` with 1,000 subscribers each re-evaluating the combined engine | 161 ms | 140 ms | ~1.15× faster |

What this means:

- **The index pays off when policies are spread across resources and actions**, which is how real policy sets look. The worst case, where every policy is in scope and its conditions must be checked, is linear in the number of policies (about 50 ns each) and gains only a little.
- **Construction is cheap and happens once:** building 500 roles takes about 0.34 ms, compiling 1,000 ABAC policies about 0.35 ms, and indexing 5,014 relation tuples about 1 ms.
- **Evaluation cost is not what limits a UI.** A screen with dozens of `useCan` calls spends well under a frame on re-evaluation. The 140 ms row is a deliberately extreme case with 1,000 simultaneous subscribers.
- Differences under roughly 5% between runs are noise.

Reproduce with:

```bash
pnpm --filter @useguardril/core run bench
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Project standards live in [AGENTS.md](./AGENTS.md).

## License

[ISC](./LICENSE)
