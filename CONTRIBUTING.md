# Contributing

Thanks for your interest in contributing to **useguardrail**, a frontend-first, framework-independent authorization SDK (RBAC, ABAC, ReBAC) written in TypeScript. Please read this guide before opening a pull request.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to uphold it. In short: be respectful and constructive. Disagreements about code and design are welcome; personal attacks are not.

## Prerequisites

- Node.js `>=18.0.0`
- [pnpm](https://pnpm.io/) `12.3.4` (this repo uses pnpm exclusively; do not commit `package-lock.json` or `yarn.lock`)

## Repository layout

This is a `pnpm` workspace:

```
packages/
  core/       # @useguardrail/core: engine, RBAC/ABAC/ReBAC evaluators, context, store
  react/      # @useguardrail/react: provider, hooks, <Can>
  adapters/   # @useguardrail/adapters: backend responses -> core contract
```

Dependencies point one way: `react` and `adapters` depend on `core`; `core` depends on neither. Each package has its own `src/`, `tests/`, `README.md`, and `CHANGELOG.md`.

## Getting started

1. **Fork** the repository and clone your fork:
   ```bash
   git clone git@github.com:<your-username>/useguardrail.git
   cd useguardrail
   ```
2. **Install dependencies**:
   ```bash
   pnpm install
   ```
3. **Create a branch** from `main` using a descriptive, prefixed name:
   ```bash
   git switch -c feat/abac-in-operator
   git switch -c fix/rebac-depth-limit
   git switch -c docs/update-readme-examples
   ```
   Common prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.

## Making changes

- Keep pull requests focused: one logical change per PR. Unrelated fixes should be separate PRs.
- Follow the standards documented in [`AGENTS.md`](./AGENTS.md). It is the source of truth for architecture, TypeScript conventions, the public API surface, and project rules (no classes outside error types, deny by default, no dependency in `core`). Read it before making non-trivial changes.
- Only export from a package's `src/index.ts` what is meant to be public API. Adding or changing an export is a public API change; treat it accordingly (see the semver rules in `AGENTS.md`).
- Never commit `dist/`, `.env*` files, real credentials, or real personal data (including in test fixtures; use synthetic users, roles, and tuples).
- Write TSDoc comments on public functions and types when the name alone isn't self-explanatory.
- Error messages and `params` must carry identifiers and positions only (role names, policy ids, paths, indexes), never user ids, tuple values, or other backend response data. New errors need a stable `code` added to `ERROR_CODES` and documented in the root README.
- Add runtime dependencies only after discussing them in an issue; `core` aims for zero. Install everything pinned to an exact version (`pnpm add -E <package>`, or `-D -E` for dev dependencies).

## Git hooks

This repo uses [husky](https://typicode.github.io/husky/) to run checks automatically via git hooks. They install for you the first time you run `pnpm install`, so you don't need to set anything up manually:

- **`pre-commit`**: runs `pnpm run lint` and `pnpm run typecheck`.
- **`commit-msg`**: rejects commits whose message doesn't follow Conventional Commits (see below).
- **`pre-push`**: runs `pnpm run test` and `pnpm run build`.

Don't bypass these with `--no-verify`. If a hook is blocking you, fix the underlying issue (or ask in the PR or issue if you think the hook itself is wrong).

## Local checks (must pass before opening a PR)

Run these from the repo root. They run across all packages, and the same checks run in CI:

```bash
pnpm run lint        # biome check
pnpm run typecheck   # tsc --noEmit in every package
pnpm run test        # vitest run in every package
pnpm run build       # tsup in every package (core builds first)
```

`pnpm run lint:fix` fixes formatting and lint issues automatically.

If you change evaluation or store code, also run the benchmarks and compare against the numbers in the root README:

```bash
pnpm --filter @useguardrail/core run bench
```

### Tests

- Add or update tests under the package's `tests/`, mirroring the structure of its `src/`.
- Cover, for each rule model you touch: allow, deny, default-deny, and malformed input.
- Invariants ("never throws", "deny wins", "traversal terminates") are also checked with property-based tests ([fast-check](https://fast-check.dev/)) in `tests/properties/`, comparing the real code against a deliberately naive reference implementation. If you change evaluation logic, extend the reference and the generators too. A failing property prints a counterexample and a seed to replay it.
- Public types are protected by type-level tests (`tests/types/*.test-d.ts`, using `expectTypeOf` and `@ts-expect-error`). They don't run: `pnpm run typecheck` fails if the declared API changes, so update them together with any intentional change to an exported type.
- Docs: every name a package exports must appear in that package's `README.md` (`tests/docs/readme-exports.test.mjs` fails otherwise). When you add or change behavior, update the READMEs in the same PR, and keep their code examples complete and accurate: they are the only documentation, there is no docs site.
- Never call a real backend or authorization service in tests; use sample payloads.
- Cross-package behavior is tested in the consuming package: `core` + `react` in `packages/react/tests/integration/`, `adapters` + `core` in `packages/adapters/tests/integration/`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/). The scope is usually the package name:

```
feat(core): add the contains operator to ABAC conditions
fix(react): avoid re-rendering when an unrelated answer changes
feat(adapters): add a SpiceDB tuples adapter
docs: explain the security model in the README
chore(deps): bump tsup to 8.6.0
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. This keeps history readable and makes it possible to automate changelogs later.

## Opening a pull request

1. Push your branch and open a PR against `main`.
2. Fill in the PR description: what changed, why, and how it was tested. Link any related issue.
3. Ensure the CI checks (typecheck, lint, test, build) pass; a PR with red checks will not be reviewed.
4. If your change affects the public API (anything exported from a package's `src/index.ts`), call that out explicitly in the PR description and note whether it's a breaking change.
5. Add a line to the affected package's `CHANGELOG.md` under an `## Unreleased` heading at the top (create it above the latest version if it is missing).
6. Be responsive to review feedback. A maintainer will merge once the PR is approved and CI is green.

## What you should *not* do

- Do not bump the `version` field in any `package.json` in a feature or fix PR. Versioning and releases are handled separately by maintainers (see the release process in `AGENTS.md`).
- Do not run `npm publish` / `pnpm publish` yourself. Publishing to npm happens exclusively through the `.github/workflows/publish.yml` GitHub Actions workflow, triggered by a maintainer publishing a GitHub Release.
- Do not weaken a safe default (deny by default, fail closed, own-property reads) to make a test or an example pass. If a default seems wrong, open an issue first.

## Reporting bugs and requesting features

Open a GitHub issue with:

- A clear description of the bug or the requested feature.
- Steps to reproduce (for bugs), including the package name and version, and the Node.js version (and React version, for `@useguardrail/react`).
- Expected vs. actual behavior, ideally with a minimal policy or role set that reproduces it.

Please do not include real credentials or real user data in issues; use synthetic data.

### Security issues

Do not open a public issue for a vulnerability (for example, a way to make a `deny` become an `allow`). Contact the maintainer privately through GitHub instead, [@SebastianUrdaneguiBisalaya](https://github.com/SebastianUrdaneguiBisalaya). Remember that client-side authorization is UX, not security (see the Security model in the README); reports about what a user can do by editing code in their own browser are expected behavior, not vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the project's [ISC License](./LICENSE).
