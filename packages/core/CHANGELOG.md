# Changelog

All notable changes to `@useguardril/core` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

### Security

- Optional inputs (`subject.roles`, `resource.id`, `context.tenantId`, `context.attributes`) and the subject `id` are read as own properties, so a polluted `Object.prototype` cannot grant roles, a tenant, or an identity.

### Added

- Loading state for `createAuthorizationStore`: `status` (`"loading" | "ready" | "error"`) and `error` in the state, a `status` config option, `setStatus`, `setError`, and `load(loader)` (atomic, abortable, never rejects, ignores stale results). Checks are denied with the new decision codes `LOADING` and `LOAD_FAILED` while not ready. New error codes `LOADER_INVALID` and `LOAD_RESULT_INVALID`.

- `createEngine`: combines evaluators with deny-overrides and default-deny, failing closed.
- `createRbacEvaluator`: roles, role inheritance, and `resource:action` permissions with wildcards.
- `createAbacEvaluator`: attribute-based policies with a closed set of condition operators.
- `createRelationGraph` and `createRebacEvaluator`: relation tuples, usersets, implied relations, and inheritance.
- `createContext`: validated, frozen multi-tenant evaluation context.
- `createStore` and `createAuthorizationStore`: reactive stores compatible with `useSyncExternalStore`.
- Stable `code` and `params` on every error (`AuthorizationError.code`, `.params`) and on every built-in decision (`Decision.code`, `.params`), plus `ERROR_CODES` and `DECISION_CODES`, so messages can be localized.
- Typed errors: `AuthorizationError`, `InvalidPolicyError`, `InvalidContextError`, `AdapterMappingError`.
