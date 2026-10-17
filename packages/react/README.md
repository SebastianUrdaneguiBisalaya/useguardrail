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
| `<Can action resource fallback? loading?>` | Renders `children` when allowed, `fallback` when denied, and `loading` while the data loads (defaults to `fallback`). |
| `useAccess(action, resource)` | `"loading" \| "allowed" \| "denied"`. Like `useCan`, but tells "still loading" apart from "denied". |
| `useAuthorizationStatus()` | `"loading" \| "ready" \| "error"`. |
| `useAuthorizationError()` | Why the last load failed, or `undefined`. |
| `useSubject()` | The current subject, or `undefined`. |
| `useAuthorizationStore()` | The store, to call `setSubject`, `setContext`, or `setEngine`. Never re-renders. |

Change who the user is, the tenant, or the policies by calling the store's setters (for example after sign-in); subscribed components update on their own.

## Loading state

Create the store in `"loading"` and fill it with `store.load(...)` (see the [core README](../core/README.md#loading-state-async-data)). Until the data arrives every check is denied, so use `<Can loading>` or `useAccess` to show a skeleton instead of flashing "no access":

```tsx
const store = createAuthorizationStore({ engine, status: "loading" });
void store.load(async ({ signal }) => {
  const me = await fetch("/api/me", { signal }).then((r) => r.json());
  return { subject: { id: me.id, roles: me.roles }, context: { tenantId: me.org } };
});

function InvoiceActions({ id }: { id: string }) {
  const status = useAuthorizationStatus();
  if (status === "error") return <RetryBanner />;

  return (
    <Can
      action="update"
      resource={{ type: "invoice", id }}
      loading={<Skeleton />}
      fallback={<ReadOnlyBadge />}
    >
      <EditButton />
    </Can>
  );
}
```

`useAccess` gives the same three-way answer as a value:

```tsx
const access = useAccess("read", { type: "invoice", id });
if (access === "loading") return <Skeleton />;
return access === "allowed" ? <Invoice /> : <NoAccess />;
```

Each hook re-renders only when its own value changes, so going from `"loading"` to `"allowed"` is a single re-render and never passes through `"denied"`.

## Errors

Using a hook or component outside an `AuthorizationProvider` throws `MissingProviderError`, which extends `AuthorizationError` from `@useguardril/core`.

## License

[ISC](../../LICENSE)
