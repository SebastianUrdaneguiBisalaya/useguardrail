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

Types exported for your own wrappers: `AccessState` (`"loading" | "allowed" | "denied"`), `CanProps`, `AuthorizationProviderProps`, `SchemaKit`, `SchemaCanProps`. `MissingProviderError` (code `PROVIDER_MISSING`) is thrown when a hook or `<Can>` runs outside an `AuthorizationProvider`.

## Typed schema

Bind the provider, `Can`, `useCan`, and `useAccess` to your schema once, and actions and resource types are checked at compile time. Use the same `AppSchema` you gave to `forSchema` from `@useguardril/core`:

```tsx
// authorization-ui.ts
import { forSchema } from "@useguardril/react";

type AppSchema = { invoice: "read" | "update" | "delete"; user: "read" | "invite" };

export const { AuthorizationProvider, Can, useCan, useAccess, useAuthorizationStore } =
  forSchema<AppSchema>();
```

```tsx
import { Can, useCan } from "./authorization-ui"; // the module you just wrote

function Example({ id }: { id: string }) {
  useCan("update", { type: "invoice", id }); // ok
  useCan("invite", { type: "invoice" }); // compile error: invite is a user action
  return (
    <Can action="invite" resource={{ type: "user" }}> {/* ok */}
      <InviteButton />
    </Can>
  );
}
```

`forSchema` returns the same components and hooks, only retyped: no runtime cost. The untyped `AuthorizationProvider` also accepts a schema-bound store.

## Loading state

Create the store in `"loading"` and fill it with `store.load(...)` (see the [core README](../core/README.md#loading-state-async-data)). Until the data arrives every check is denied, so use `<Can loading>` or `useAccess` to show a skeleton instead of flashing "no access":

```tsx
import { createAuthorizationStore } from "@useguardril/core";
import { Can, useAuthorizationStatus } from "@useguardril/react";

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
import { useAccess } from "@useguardril/react";

function InvoicePage({ id }: { id: string }) {
  const access = useAccess("read", { type: "invoice", id });
  if (access === "loading") return <Skeleton />;
  return access === "allowed" ? <Invoice /> : <NoAccess />;
}
```

Each hook re-renders only when its own value changes, so going from `"loading"` to `"allowed"` is a single re-render and never passes through `"denied"`.

## Debugging a hidden component

Ask the store why a check came out the way it did, from a component or from the console:

```tsx
import { useAuthorizationStore } from "@useguardril/react";

function DebugInvoice({ id }: { id: string }) {
  const store = useAuthorizationStore(); // does not subscribe, so it never re-renders
  console.log(store.explain("update", { type: "invoice", id })); // decision, status, per-evaluator trace
  return null;
}
```

To see every check, pass `onDecision` to `createAuthorizationStore`. Components call `can` while rendering, so it fires on every render-time check (and twice in `StrictMode`): use it to inspect decisions, not to count user actions. See the [root README](../../README.md#debugging-and-auditing).

## Server-side rendering and hydration

Works with Next.js, Remix, and any `renderToString` / streaming setup. Every hook passes `store.getInitialSnapshot()` to React as the server snapshot, so the server render and the first client render both use the store's **initial** state. Hydration therefore never mismatches, even if the client store already received data before React hydrated; React then re-renders with the live state.

Consequences, and what to do:

1. **Put the data in at creation, identically on the server and the client.** Fetch the session on the server and pass it down as plain props (a Server Component in Next.js), then create the store from it:

   ```tsx
   "use client";
   import { createAuthorizationStore } from "@useguardril/core";
   import { AuthorizationProvider } from "@useguardril/react";
   import { useState, type ReactNode } from "react";

   export function Providers({ session, children }: { session: Session; children: ReactNode }) {
     // useState keeps one store per component instance, on the server and in the browser.
     const [store] = useState(() =>
       createAuthorizationStore({
         engine,
         subject: session.subject,
         context: session.context,
       }),
     );
     return <AuthorizationProvider store={store}>{children}</AuthorizationProvider>;
   }
   ```

2. **Never create the store at module level on the server.** A server process serves many users; a module-level store would hand one user's subject to the next request. Create it per request (as above, inside the component, or in your request handler).
3. **Changes after creation are not part of the server render.** `setSubject`, `setStatus`, and `load` change the live state (the client picks them up right after hydration), but the server renders what the store was created with. Do not call `load` on the server: rendering is synchronous. Use `status: "loading"` with `<Can loading>` only for client-side fetching.
4. Client-only apps (Vite, CRA) need nothing special.

## React versions, StrictMode, and concurrent rendering

- Supported: React 18 and 19. CI runs the adapter's checks against React 19 and React 18.3.
- Safe in `StrictMode`: subscriptions are balanced across the double-invoked effects and released on unmount.
- Safe with concurrent features (`startTransition`, `useDeferredValue`, Suspense): the hooks use `useSyncExternalStore`, so a render never reads two different store states (no tearing). Store updates are always applied synchronously, as `useSyncExternalStore` requires.

## Errors

Using a hook or component outside an `AuthorizationProvider` throws `MissingProviderError`, which extends `AuthorizationError` from `@useguardril/core`.

## License

[ISC](../../LICENSE)
