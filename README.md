# useguardrail

A frontend-first, framework-independent authorization SDK for TypeScript. Describe who can do what with **RBAC**, **ABAC**, and **ReBAC**, evaluate it synchronously in the browser or in Node, and keep your UI in sync through a small reactive store.

> **Client-side authorization is UX, not security.** Use it to decide what to show, enable, or route to. Your backend must always re-enforce every decision. These packages hold no secrets and never call a server.

> **Status:** `0.1.x`, published on npm under the `@useguardrail` scope. The public API may still change before 1.0; every change is listed in each package's `CHANGELOG.md`.

## Contents

- [Packages](#packages)
- [Why useguardrail](#why-useguardrail)
- [Concepts](#concepts)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How decisions are combined](#how-decisions-are-combined)
- [Loading state](#loading-state)
- [Multi-tenancy and public access](#multi-tenancy-and-public-access)
- [Recipes](#recipes)
- [Typed actions and resources](#typed-actions-and-resources)
- [Debugging and auditing](#debugging-and-auditing)
- [Security model](#security-model)
- [Limits and edge behavior](#limits-and-edge-behavior)
- [Error codes and localization](#error-codes-and-localization)
- [Performance](#performance)

## Packages

| Package | Description |
|---|---|
| [`@useguardrail/core`](./packages/core) | The engine: RBAC, ABAC, and ReBAC evaluators, multi-tenant context, and a reactive store. No UI dependencies, zero runtime dependencies. |
| [`@useguardrail/react`](./packages/react) | React adapter: `AuthorizationProvider`, `useCan`, `<Can>`. Re-renders a component only when its own answer changes. |
| [`@useguardrail/adapters`](./packages/adapters) | Normalizes backend responses (sessions, roles, OpenFGA and SpiceDB relation tuples) into the core contract. |

## Why useguardrail

- **Three models, one API.** RBAC, ABAC, and ReBAC are pluggable evaluators that compose into a single decision.
- **Safe by default.** Deny always wins, no opinion means deny, and an evaluator that throws or returns garbage also means deny.
- **Framework-independent.** The engine knows nothing about React. The React adapter is a thin layer over a store contract (`subscribe` / `getSnapshot`) that works with `useSyncExternalStore`.
- **Fast.** Microsecond evaluations at realistic sizes (see [Performance](#performance)).
- **Explicit multi-tenancy.** The tenant travels in the evaluation context, never in module-level state.

## Concepts

| Term | What it is |
|---|---|
| **Subject** | Who is asking: `{ id, roles?, attributes? }`. |
| **Resource** | What is being accessed: `{ type, id?, attributes? }`. |
| **Action** | What they want to do, a string such as `"update"`. |
| **Context** | The situation: `{ tenantId?, attributes? }`. |
| **Evaluator** | One authorization model (RBAC, ABAC, or ReBAC). It allows, denies, or has no opinion. |
| **Engine** | Combines evaluators into one **Decision**: `{ effect: "allow" \| "deny", reason, code?, params? }`. |
| **Store** | Holds the engine, the subject, the context, and a loading status. It is what UIs subscribe to. |

## Requirements

| | |
|---|---|
| Runtime | Node 18+, or a browser with `Object.hasOwn`, `queueMicrotask`, and `AbortController` (Chrome 93+, Firefox 92+, Safari 15.4+, Edge 93+). |
| React adapter | React 18 or 19. |
| TypeScript | Types are tested with TypeScript 5.7. Schema typing uses template literal types. |
| Formats | ESM and CommonJS, both with type declarations. |
| Dependencies | None at runtime. |

## Quick start

```bash
pnpm add -E @useguardrail/core @useguardrail/react
```

```tsx
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
} from "@useguardrail/core";
import { AuthorizationProvider, Can, useCan } from "@useguardrail/react";

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

Not using React? `@useguardrail/core` works on its own:

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
import { createAuthorizationStore } from "@useguardrail/core";
import { Can } from "@useguardrail/react";

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

## Multi-tenancy and public access

**Tenants.** The tenant always travels in `context.tenantId`. For ReBAC, `createTenantRelationGraph` gives each tenant its own graph, and the evaluator picks it by `context.tenantId`, so a relation in one tenant can never grant access in another, even when their references look alike. With no tenant, or an unknown one, the evaluator has no opinion and the result is `deny`.

```ts
import { createRebacEvaluator, createTenantRelationGraph } from "@useguardrail/core";

const graph = createTenantRelationGraph({
  tuples: {
    acme: [{ object: "doc:1", relation: "viewer", subject: "user:ana" }],
    globex: [{ object: "doc:1", relation: "viewer", subject: "user:bob" }],
  },
});
const rebac = createRebacEvaluator({ graph, requirements: { doc: { read: "viewer" } } });

store.setContext({ tenantId: "acme" }); // switching tenant switches the graph
```

**Public access.** A tuple whose subject is `"<type>:*"` grants the relation to every subject of that type, the way OpenFGA does:

```ts
{ object: "doc:handbook", relation: "viewer", subject: "user:*" } // any "user:..."
```

Details, limits, and the rules for wildcards are in the [core README](./packages/core/README.md#rebac-createrelationgraph--createrebacevaluator). RBAC and ABAC have no tenant graph: carry the tenant in the roles you load for that tenant, or compare `context.tenantId` in an ABAC condition.

## Recipes

Short, copy-pasteable answers to common needs. They assume a `store` created as in the [Quick start](#quick-start).

### Sign in and sign out

```ts
// After your sign-in call succeeds: fetch the session and put it in the store.
await store.load(async ({ signal }) => {
  const me = await fetch("/api/me", { signal }).then((r) => r.json());
  return { subject: { id: me.id, roles: me.roles }, context: { tenantId: me.org } };
});

// Sign out: everything is denied (NO_SUBJECT) until someone signs in again.
store.setSubject(undefined);
```

### Refresh permissions when they change

```ts
// Call it whenever you learn permissions may have changed: a websocket message,
// window focus, a timer, or right after an admin action.
function refreshPermissions() {
  return store.load(async ({ signal }) => {
    const me = await fetch("/api/me", { signal }).then((r) => r.json());
    return { subject: { id: me.id, roles: me.roles } };
  });
}
```

A newer `load` aborts the one still running and its result is ignored, so calling it often is safe. Components update on their own. If the rules themselves changed, return a new engine too: `return { subject, engine: createEngine({ evaluators }) }`.

### Switch tenant

```ts
// When each tenant has its own data (roles, relations): reload for the new tenant.
await store.load(async ({ signal }) => {
  const data = await fetch(`/api/tenants/${tenantId}/session`, { signal }).then((r) => r.json());
  return { subject: data.subject, context: { tenantId } };
});

// When you already hold every tenant's data (see "Multi-tenancy"): just change the context.
store.setContext({ tenantId: "globex" });
```

### Users can edit their own records

An ABAC policy compares a subject field with a resource field:

```ts
import { createAbacEvaluator } from "@useguardrail/core";

const ownership = createAbacEvaluator({
  policies: [
    {
      id: "authors-edit-their-posts",
      effect: "allow",
      actions: ["update", "delete"],
      resources: ["post"],
      conditions: [{ field: "subject.id", op: "eq", valueFrom: "resource.attributes.authorId" }],
    },
  ],
});

// The resource you check carries the attribute:
store.can("update", { type: "post", id: "9", attributes: { authorId: "user:ana" } });
```

### Plans and feature flags

Put the plan or flag in the context and test it in a policy:

```ts
import { createAbacEvaluator } from "@useguardrail/core";

const flags = createAbacEvaluator({
  policies: [
    {
      id: "reports-need-a-paid-plan",
      effect: "allow",
      actions: ["read"],
      resources: ["report"],
      conditions: [{ field: "context.attributes.plan", op: "in", value: ["pro", "enterprise"] }],
    },
  ],
});

store.setContext({ tenantId: "acme", attributes: { plan: "pro" } });
```

### Hide, disable, or show a placeholder

```tsx
import { Can, useAccess, useCan } from "@useguardrail/react";

function InvoiceRow({ id }: { id: string }) {
  const invoice = { type: "invoice", id };
  const canDelete = useCan("delete", invoice); // disable
  const access = useAccess("read", invoice); // tell "loading" apart from "denied"

  if (access === "loading") return <Skeleton />;
  return (
    <>
      <Can action="update" resource={invoice}>
        <EditButton /> {/* hidden when not allowed */}
      </Can>
      <button disabled={!canDelete}>Delete</button>
    </>
  );
}
```

### Guard a route

Outside React, use the store directly. Wait for the session first so a slow load is not read as "denied":

```ts
import { redirect } from "react-router";

const sessionReady = store.load(fetchSession); // started once, when the app starts

export async function invoiceLoader({ params }: { params: { id: string } }) {
  await sessionReady;
  if (!store.can("read", { type: "invoice", id: params.id })) {
    throw redirect("/forbidden");
  }
  return null;
}
```

A guard only improves the experience: your server must still refuse the request.

### Use it without a framework

```ts
const invoice = { type: "invoice", id: "42" };
const button = document.querySelector<HTMLButtonElement>("#delete")!;

button.hidden = !store.can("delete", invoice);
// Runs only when this specific answer changes, not on every store change.
store.subscribeSelector(
  () => store.can("delete", invoice),
  (allowed) => {
    button.hidden = !allowed;
  },
);
```

### Test your own rules

Rules are plain data, so they are easy to test without a UI:

```ts
import { createEngine, createRbacEvaluator } from "@useguardrail/core";
import { expect, it } from "vitest";

it("viewers cannot update invoices", () => {
  const engine = createEngine({
    evaluators: [
      createRbacEvaluator({ roles: { viewer: { permissions: ["invoice:read"] } } }),
    ],
  });
  const request = {
    subject: { id: "user:ana", roles: ["viewer"] },
    action: "update",
    resource: { type: "invoice" },
    context: {},
  };

  expect(engine.evaluate(request).effect).toBe("deny");
  expect(engine.explain(request).trace).toEqual([{ index: 0, outcome: "abstain" }]);
});
```

### Load roles and relations from your backend

Use the adapters to turn whatever your API returns into the shapes above: see [`@useguardrail/adapters`](./packages/adapters).

## Typed actions and resources

By default actions and resource types are plain strings. Declare a **schema** and the compiler checks them everywhere: permission strings, policy scopes, relation requirements, and every `can(...)` / `useCan(...)` / `<Can>`. A typo or an action on the wrong resource stops compiling.

```ts
// authorization.ts
import { forSchema } from "@useguardrail/core";

// Resource type -> the actions it supports. Declare it with `type`, not `interface`.
type AppSchema = {
  invoice: "read" | "update" | "delete";
  user: "read" | "invite";
};

export const auth = forSchema<AppSchema>();

const rbac = auth.createRbacEvaluator({
  roles: {
    editor: { permissions: ["invoice:update", "user:*", "*:read"] },
    // "invoice:invite"  -> compile error: invite is not an invoice action
    // "order:read"      -> compile error: order is not in the schema
  },
});

const abac = auth.createAbacEvaluator({
  policies: [{ id: "no-delete", effect: "deny", actions: ["delete"], resources: ["invoice"] }],
});

const rebac = auth.createRebacEvaluator({
  graph,
  requirements: { invoice: { read: "viewer", update: "editor" }, user: { invite: "admin" } },
});

export const store = auth.createAuthorizationStore({
  engine: auth.createEngine({ evaluators: [rbac, abac, rebac] }),
  subject,
});

store.can("update", { type: "invoice", id }); // ok
store.can("invite", { type: "invoice" }); // compile error
store.can("read", { type: "order" }); // compile error
```

For React, bind the components once and import them from your own module:

```tsx
// authorization-ui.ts
import { forSchema } from "@useguardrail/react";
import type { AppSchema } from "./authorization";

export const { AuthorizationProvider, Can, useCan, useAccess } = forSchema<AppSchema>();

// anywhere
const canEdit = useCan("update", { type: "invoice", id });
<Can action="invite" resource={{ type: "user" }}>...</Can>;
<Can action="invite" resource={{ type: "invoice" }} />; // compile error
```

What is checked:

| Where | What the schema enforces |
|---|---|
| RBAC `permissions` | `"*"`, `"<type>:<action>"`, `"<type>:*"`, `"*:<action>"`, using only the types and actions you declared |
| ABAC `actions` / `resources` | Declared actions and resource types (or `"*"`) |
| ReBAC `requirements` | Declared resource types, each with only its own actions |
| `store.can` / `store.evaluate` / `engine.evaluate` | An action must belong to the resource type it is paired with |
| `useCan` / `useAccess` / `<Can>` | Same, through `forSchema` from `@useguardrail/react` |

Good to know:

- **It is compile-time only.** `forSchema` returns the very same functions; nothing is added at runtime. Plain JavaScript callers (or `as any` casts) are still validated at runtime, so a malformed permission still throws `InvalidPolicyError`.
- **Schema-less evaluators mix in.** An evaluator built without a schema (for example from roles loaded by an adapter, where permissions are plain strings) is accepted by a typed engine and a typed store; it is simply not checked. The reverse is not allowed: a schema-bound evaluator does not fit an engine without that schema.
- **Without `forSchema`** you can pass the type argument yourself (`createEngine<AppSchema>(...)`), and TypeScript infers the schema from a typed engine or evaluator (`createAuthorizationStore({ engine })`).
- **Custom evaluators** typed as `Evaluator<AppSchema>` receive requests whose `action` and `resource.type` are consistent. TypeScript does not narrow `input.action` from `input.resource.type` (the discriminant is nested), so compare them yourself when you need to.

## Debugging and auditing

The library never logs. Instead you can ask it **why** something was decided, or hand it a callback that receives every decision, and do whatever you want with it.

**Why was this denied?** Ask the store (or the engine) to explain a check:

```ts
const { decision, status, trace } = store.explain("update", { type: "invoice", id: "42" });

decision; // { effect: "deny", code: "DEFAULT_DENY", reason: "No evaluator granted access (default deny)." }
status; // "ready"  (or "loading" / "error" when the data is not there yet)
trace; // [ { index: 0, outcome: "abstain" }, { index: 1, outcome: "abstain" } ]
```

`trace` has one entry per evaluator that was consulted, in order, with what it answered:

| `outcome` | Meaning |
|---|---|
| `"allow"` / `"deny"` | It returned that decision (`trace[i].decision`). |
| `"abstain"` | It had no opinion. |
| `"threw"` | It threw (`trace[i].error` holds what it threw; the decision itself never exposes it). |
| `"malformed"` | It returned something that is not a decision. |

Evaluation stops at the first evaluator that denies, throws, or misbehaves, so later evaluators do not appear. When the store is `"loading"`, in `"error"`, or has no subject, the engine is never consulted and `trace` is empty; the `decision.code` (`LOADING`, `LOAD_FAILED`, `NO_SUBJECT`) says why.

**Seeing every decision.** `onDecision` is called after each one. Turn it on only where you want it:

```ts
import { createAuthorizationStore, createEngine } from "@useguardrail/core";

const engine = createEngine({
  evaluators,
  // Every evaluation: request, decision, and per-evaluator trace.
  // (`import.meta.env.DEV` is Vite's flag; use whatever tells you "development" in your build.)
  onDecision: import.meta.env.DEV
    ? ({ input, decision }) => console.debug("[authz]", input.action, input.resource.type, decision.code)
    : undefined,
});

const store = createAuthorizationStore({
  engine,
  // Every check made through the store, including those that never reach the engine.
  onDecision: ({ action, status, decision }) => audit.push({ action, status, code: decision.code }),
});
```

| Hook | Fires on | Event |
|---|---|---|
| `createEngine({ onDecision })` | Every `engine.evaluate` / `engine.explain`, whoever calls it | `{ input, decision, trace }` |
| `createAuthorizationStore({ onDecision })` | Every `store.can` / `evaluate` / `explain`, including checks denied while loading, failed, or signed out | `{ action, resource, subject, context, status, decision, trace }` |

Things to know:

- **It cannot change the decision.** The hook runs after the decision is made. If it throws, the decision is unaffected and the error is rethrown asynchronously (it shows up as an unhandled error; catch it with `window.addEventListener("error", ...)`).
- **It fires on every check, not once per user action.** Components call `can` while rendering, so the same check can be reported several times per render (React may also render twice in `StrictMode`). It is for debugging and for inspecting decisions, not for counting what users did.
- **Events contain the full request**, including subject and resource attributes. Redact them before sending them to a logging service.
- **No cost when unused.** Without a hook, no trace is built.
- **Client-side records can be tampered with** by whoever controls the browser (see [Security model](#security-model)). Audit what matters on the server.

## Security model

What the SDK defends against:

- **Hostile data.** Backend or user-supplied JSON cannot reach the prototype chain: field paths read own properties only and reject `__proto__`, `constructor`, and `prototype`; lookups use `Map`s; optional inputs (`roles`, `tenantId`, a resource `id`) are read as own properties, so a polluted `Object.prototype` cannot grant roles or a tenant; there is no `eval`.
- **Mistakes.** Deny wins, no opinion means deny, and failures deny.

What it cannot defend against, by design: **anyone who controls the browser.** A user with devtools, a malicious extension, or an XSS payload can call `store.setSubject({ id: "x", roles: ["admin"] })`, patch built-in functions, or edit the bundle, and no client-side library can stop that. It is also why the backend must re-check every action. Treat `can()` as "should I show this?", never as "may this happen?".

Pass plain data objects (not class instances with prototype getters) as subjects, resources, and contexts.

**Server rendering:** create the authorization store per request, never at module level on the server, or one user's subject can leak into another user's render. See [SSR and hydration](./packages/react/README.md#server-side-rendering-and-hydration).

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
| ABAC conditions nesting (`all` / `any` / `not`) | 8 levels (`MAX_CONDITION_DEPTH`) | Deeper conditions throw `InvalidPolicyError` (`CONDITION_TOO_DEEP`) when the evaluator is created. |
| ABAC `not` over a missing value | — | The comparison fails because the value is missing, so `not` makes it true. Prefer positive conditions in `allow` policies and use `deny` policies for exclusions. |
| ReBAC resource without an `id`, or an action with no requirement | — | The evaluator has no opinion, so the result is `deny` unless another evaluator allows. |
| An `onDecision` hook that throws | — | The decision is unaffected; the hook's error is rethrown asynchronously. |
| An evaluator that throws, or returns a malformed decision | — | `deny`. The error detail is not exposed in the decision. |
| An evaluator called directly (outside an engine or store) with a structurally invalid input | — | May throw a `TypeError`. The engine and the store catch it and deny, so always evaluate through one of them. |
| ReBAC wildcard in a userset (`team:*#member`) or with no type (`:*`) | not supported | Rejected when the graph is created (`TUPLE_REFERENCE_INVALID`). Plain `<type>:*` subjects are supported. |
| ReBAC tenant graph with no `context.tenantId`, or an unknown tenant | — | The evaluator has no opinion, so the result is `deny`. |
| Schema typing (`forSchema`) | compile-time only | No runtime effect: plain JavaScript callers are still validated when evaluators are created. |
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
import { AuthorizationError, createRbacEvaluator, type ErrorCode } from "@useguardrail/core";

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
| Context, subject, engine | `CONTEXT_NOT_OBJECT`, `CONTEXT_TENANT_ID_INVALID`, `CONTEXT_ATTRIBUTES_INVALID`, `SUBJECT_INVALID`, `ENGINE_REQUIRED`, `EVALUATORS_INVALID`, `LOADER_INVALID`, `LOAD_RESULT_INVALID`, `ON_DECISION_INVALID` | — |
| RBAC | `RBAC_ROLES_INVALID` | — |
| | `ROLE_NOT_OBJECT`, `ROLE_PERMISSIONS_INVALID`, `ROLE_INHERITS_INVALID` | `role` |
| | `PERMISSION_NOT_STRING`, `PERMISSION_FORMAT_INVALID` | `role`, `index` |
| | `ROLE_INHERITANCE_CYCLE` | `cycle` |
| | `ROLE_INHERITS_UNKNOWN` | `role`, `inherited` |
| ABAC | `ABAC_POLICIES_INVALID` | — |
| | `POLICY_NOT_OBJECT`, `POLICY_ID_INVALID` | `index` |
| | `POLICY_ID_DUPLICATE`, `POLICY_EFFECT_INVALID`, `POLICY_CONDITIONS_INVALID`, `CONDITION_NOT_OBJECT`, `CONDITION_SHAPE_INVALID`, `CONDITION_EXISTS_INVALID`, `CONDITION_VALUE_SOURCE_INVALID` | `policyId` |
| | `CONDITION_GROUP_INVALID` | `policyId`, `operator` (`all` or `any`) |
| | `CONDITION_TOO_DEEP` | `policyId`, `maxDepth` |
| | `POLICY_SCOPE_INVALID` | `policyId`, `option` |
| | `CONDITION_OPERATOR_UNKNOWN`, `CONDITION_ARRAY_REQUIRED` | `policyId`, `operator` |
| | `CONDITION_FIELD_INVALID` | `policyId`, `field` |
| ReBAC | `GRAPH_TUPLES_INVALID`, `GRAPH_RULES_INVALID`, `GRAPH_MAX_DEPTH_INVALID`, `TENANT_GRAPH_INVALID`, `TENANT_ID_INVALID`, `REBAC_GRAPH_REQUIRED`, `REBAC_REQUIREMENTS_INVALID` | — |
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
- **Construction is cheap and happens once:** building 500 roles takes about 0.34 ms, compiling 1,000 ABAC policies about 0.65 ms, and indexing 5,014 relation tuples about 1 ms.
- **Evaluation cost is not what limits a UI.** A screen with dozens of `useCan` calls spends well under a frame on re-evaluation. The 140 ms row is a deliberately extreme case with 1,000 simultaneous subscribers.
- Differences under roughly 5% between runs are noise.

Reproduce with:

```bash
pnpm --filter @useguardrail/core run bench
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Project standards live in [AGENTS.md](./AGENTS.md).

## License

[ISC](./LICENSE)
