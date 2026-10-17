# Changelog

All notable changes to `@useguardrail/adapters` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-10-17

### Added

- Docs: OpenFGA wildcard subjects (`user:*`) now take effect in the core graph.

- `createSessionAdapter`: session/profile response to `Subject` and `Context`.
- `createRolesAdapter`: roles response to RBAC role definitions.
- `createTuplesAdapter`, `openFgaTuplesAdapter`, `spiceDbTuplesAdapter`: relation tuples for the ReBAC graph.
- `Adapter<T>` type for custom adapters.
