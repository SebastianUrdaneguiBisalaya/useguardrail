# Changelog

All notable changes to `@useguardril/react` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

### Added

- Docs and tests for debugging checks made from components (`store.explain`, `onDecision`).

- `forSchema<S>()`: the provider, `Can`, `useCan`, and `useAccess` bound to a schema (compile-time only). `AuthorizationProvider` is now generic and accepts schema-bound stores.

- Hooks use the store's initial snapshot as the server snapshot: hydration never mismatches. Tested for server rendering, hydration, `StrictMode`, and concurrent rendering; CI also runs the package against React 18.

- `useAccess` (`"loading" | "allowed" | "denied"`), `useAuthorizationStatus`, `useAuthorizationError`, and a `loading` prop on `<Can>`.

- `AuthorizationProvider`, `useAuthorizationStore`, `useCan`, `useSubject`, and `<Can>`.
- `MissingProviderError` (code `PROVIDER_MISSING`).
- Selective re-rendering through `useSyncExternalStore`, covered by core + react integration tests.
