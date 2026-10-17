# @useguardril/react

React adapter for [`@useguardril/core`](../core): a provider, hooks, and a `<Can>` component built on `useSyncExternalStore`, so a component re-renders **only when its own answer changes**.

> **Client-side authorization is UX, not security.** Use it to decide what to show or enable. Your backend must always re-enforce every decision.

## Installation

```bash
pnpm add -E @useguardril/core @useguardril/react
```

Requires React 18 or newer. Ships a `"use client"` directive, so it works in Next.js client components.

## Usage

```tsx
import { createAuthorizationStore, createEngine, createRbacEvaluator } from "@useguardril/core";
import { AuthorizationProvider, Can, useCan } from "@useguardril/react";

const engine = createEngine({
  evaluators: [
    createRbacEvaluator({
      roles: { editor: { permissions: ["invoice:read", "invoice:update"] } },
    }),
  ],
});

// Create the store once, outside React, or memoize it.
const store = createAuthorizationStore({
  engine,
  subject: { id: "user:ana", roles: ["editor"] },
  context: { tenantId: "acme" },
});

function App() {
  return (
    <AuthorizationProvider store={store}>
      <Invoice id="42" />
    </AuthorizationProvider>
  );
}

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
```

## API

| Export | Purpose |
|---|---|
| `AuthorizationProvider` | Provides a store to the tree. Takes a `store` prop. |
| `useCan(action, resource)` | `boolean`. Re-renders only when this answer flips. |
| `<Can action resource fallback?>` | Renders `children` when allowed, `fallback` otherwise. |
| `useSubject()` | The current subject, or `undefined`. |
| `useAuthorizationStore()` | The store, to call `setSubject`, `setContext`, or `setEngine`. Never re-renders. |

Change who the user is, the tenant, or the policies by calling the store's setters (for example after sign-in); subscribed components update on their own.

## Errors

Using a hook or component outside an `AuthorizationProvider` throws `MissingProviderError`, which extends `AuthorizationError` from `@useguardril/core`.

## License

[ISC](../../LICENSE)
