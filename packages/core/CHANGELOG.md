# Changelog

All notable changes to `@useguardrail/core` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-10-17

### Security

- Optional inputs (`subject.roles`, `resource.id`, `context.tenantId`, `context.attributes`) and the subject `id` are read as own properties, so a polluted `Object.prototype` cannot grant roles, a tenant, or an identity.

### Added

- ReBAC wildcard subjects (`"<type>:*"`, public access for every subject of that type) and `createTenantRelationGraph`: one isolated graph per tenant, picked by `context.tenantId` in `createRebacEvaluator`. New types `TenantRelationGraph`, `TenantRelationGraphConfig`; new error codes `TENANT_GRAPH_INVALID`, `TENANT_ID_INVALID`.

- ABAC condition groups: `all` (AND), `any` (OR), and `not`, nestable up to `MAX_CONDITION_DEPTH` (8) levels. `Condition` is now a union of `FieldCondition`, `AllCondition`, `AnyCondition`, and `NotCondition` (plain field comparisons are unchanged). Empty groups and ambiguous nodes are rejected. New error codes `CONDITION_SHAPE_INVALID`, `CONDITION_GROUP_INVALID`, `CONDITION_TOO_DEEP`.

- Debugging and auditing: `engine.explain(input)` and `store.explain(action, resource)` (decision plus a per-evaluator trace), and an `onDecision` hook on `createEngine` and `createAuthorizationStore`. New types `DecisionEvent`, `StoreDecisionEvent`, `EvaluatorTrace`, `EvaluatorOutcome`; new error code `ON_DECISION_INVALID`. No cost when the hook is absent.

- Typed actions and resources: `Schema`, `forSchema<S>()`, and schema-aware `Engine<S>`, `Evaluator<S>`, `EvaluationInput<S>`, `AuthorizationStore<S>`, `RbacConfig<S>` (with `PermissionString<S>`), `AbacPolicy<S>`, and `RebacRequirements<S>`. Compile-time only; every type defaults to the loose schema, so existing code is unchanged.

- `store.getInitialSnapshot()` (and `getInitialSnapshot` on `createStore`) plus the pure `evaluateState(state, action, resource)`, so UI adapters can render the same answer on the server and during hydration.

- Loading state for `createAuthorizationStore`: `status` (`"loading" | "ready" | "error"`) and `error` in the state, a `status` config option, `setStatus`, `setError`, and `load(loader)` (atomic, abortable, never rejects, ignores stale results). Checks are denied with the new decision codes `LOADING` and `LOAD_FAILED` while not ready. New error codes `LOADER_INVALID` and `LOAD_RESULT_INVALID`.

- `createEngine`: combines evaluators with deny-overrides and default-deny, failing closed.
- `createRbacEvaluator`: roles, role inheritance, and `resource:action` permissions with wildcards.
- `createAbacEvaluator`: attribute-based policies with a closed set of condition operators.
- `createRelationGraph` and `createRebacEvaluator`: relation tuples, usersets, implied relations, and inheritance.
- `createContext`: validated, frozen multi-tenant evaluation context.
- `createStore` and `createAuthorizationStore`: reactive stores compatible with `useSyncExternalStore`.
- Stable `code` and `params` on every error (`AuthorizationError.code`, `.params`) and on every built-in decision (`Decision.code`, `.params`), plus `ERROR_CODES` and `DECISION_CODES`, so messages can be localized.
- Typed errors: `AuthorizationError`, `InvalidPolicyError`, `InvalidContextError`, `AdapterMappingError`.
