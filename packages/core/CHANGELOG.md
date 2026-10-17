# Changelog

All notable changes to `@useguardril/core` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

### Added

- `createEngine`: combines evaluators with deny-overrides and default-deny, failing closed.
- `createRbacEvaluator`: roles, role inheritance, and `resource:action` permissions with wildcards.
- `createAbacEvaluator`: attribute-based policies with a closed set of condition operators.
- `createRelationGraph` and `createRebacEvaluator`: relation tuples, usersets, implied relations, and inheritance.
- `createContext`: validated, frozen multi-tenant evaluation context.
- `createStore` and `createAuthorizationStore`: reactive stores compatible with `useSyncExternalStore`.
- Typed errors: `AuthorizationError`, `InvalidPolicyError`, `InvalidContextError`, `AdapterMappingError`.
