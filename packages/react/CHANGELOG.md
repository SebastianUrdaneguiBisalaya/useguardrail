# Changelog

All notable changes to `@useguardril/react` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

### Added

- `useAccess` (`"loading" | "allowed" | "denied"`), `useAuthorizationStatus`, `useAuthorizationError`, and a `loading` prop on `<Can>`.

- `AuthorizationProvider`, `useAuthorizationStore`, `useCan`, `useSubject`, and `<Can>`.
- `MissingProviderError` (code `PROVIDER_MISSING`).
- Selective re-rendering through `useSyncExternalStore`, covered by core + react integration tests.
