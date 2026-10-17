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

See [CONTRIBUTING.md](./CONTRIBUTING.md). Project standards live in [AGENTS.md](./AGENTS.md).

## License

[ISC](./LICENSE)
