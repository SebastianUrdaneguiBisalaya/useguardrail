# Node.js SDK Template

A template for building Node.js SDKs in TypeScript that wrap a third-party HTTP API — bundled with `tsup`, dual ESM/CJS support, and ready to publish to npm.

> This is a **template repository**, not a finished SDK. Use GitHub's **"Use this template" → "Create a new repository"** button to generate a new project from it (Settings → General → "Template repository" must be enabled on this repo). Cloning it directly also works, but you'll be carrying this repo's git history along.

## Repository layout

This is a `pnpm` workspace (see `pnpm-workspace.yaml`), not a single package:

```
packages/
  core/          # the publishable SDK — everything below refers to this package
```

All commands below run from the **repo root** and delegate to the right workspace package via `pnpm --filter` (see the root `package.json` scripts) — you don't need to `cd` into `packages/core` for day-to-day work. See `AGENTS.md` (sections 8-9) for why this layout exists and how to add provider packages (`packages/<provider>`) to it.

## Using this template for a new SDK

After creating a new repo from this template:

1. Update `packages/core/package.json`: `name`, `description`, `keywords`, `author`, `repository` (if added), and remove `"private": true` (it's set here so the template itself can never be accidentally published to npm).
2. `.github/workflows/publish.yml` already guards against publishing from a fork with `if: ${{ !github.event.repository.fork }}` — no repo path to hard-code, it works as-is.
3. Replace the generic `Client` placeholder throughout `AGENTS.md`'s "Project context" section with the actual third-party API you're wrapping (client design, resource modules, error classes, credential handling — see that section for the checklist).
4. Update this README's title, description, and examples once `packages/core/src/index.ts` has real exports.
5. If the SDK handles a secret/API key, keep the server-side-only enforcement described in `AGENTS.md` (section 6) — don't skip that when adapting the template.

## Development

This is the exact sequence to run after making a source change, and how to actually try the built package locally. Run every command from the repo root with `pnpm` — they delegate to `packages/core` automatically.

### After any change to `packages/core/src/`, `tsup.config.ts`, `tsconfig.json`, or `package.json`

Run these in order and fix any failure before moving to the next step — don't skip ahead on a red step:

```bash
pnpm install          # only needed if dependencies changed
pnpm run lint:fix      # auto-fix formatting/lint issues (biome)
pnpm run typecheck     # tsc --noEmit — catches type errors
pnpm run test          # vitest run
pnpm run build         # tsup — confirms the package actually bundles
```

Notes:
- `pnpm run lint:fix` before `typecheck`/`test` so formatting noise never masks a real diff in review.
- If the change touched exports in `packages/core/src/index.ts`, treat it as a public API change: bump the version following semver and update `CHANGELOG.md`/docs accordingly (see [AGENTS.md](./AGENTS.md)).
- `.husky/pre-commit` already runs `lint` + `typecheck` and `.husky/pre-push` already runs `test` + `build` automatically — running them manually first just means you catch problems before the hook does, which is faster feedback.

### Trying the built package locally, as a consumer would

Running `pnpm run build` alone is not enough to know the package works when installed — `exports`, `dist` file paths, and CJS/ESM interop can only be verified by actually installing the built tarball somewhere else.

```bash
pnpm run build
pnpm --filter ./packages/core pack   # produces <package-name>-<version>.tgz in packages/core/
```

Then, in a separate scratch project (not inside this repo):

```bash
mkdir -p /tmp/sdk-smoke-test && cd /tmp/sdk-smoke-test
npm init -y
npm install /absolute/path/to/<package-name>-<version>.tgz
```

Verify both module systems resolve correctly:

```js
// esm.mjs
import { createClient } from "<package-name>";
console.log(typeof createClient);
```
```js
// cjs.cjs
const { createClient } = require("<package-name>");
console.log(typeof createClient);
```
```bash
node esm.mjs
node cjs.cjs
```

Also open the scratch project in an editor and check that hovering `createClient` shows the expected types — this catches broken `.d.ts` generation that compiling alone won't.

Alternatively, for faster iteration while actively developing against another local project, use `pnpm link` instead of repacking on every change:

```bash
# in this repo
pnpm run build
pnpm --filter ./packages/core link --global

# in the consumer project
pnpm link --global <package-name>
```

Remember to `pnpm unlink --global <package-name>` in the consumer project once done, so it goes back to resolving the real published version.

### Before opening a pull request

```bash
git switch -c feat/short-description   # or fix/, docs/, refactor/, test/, chore/ — see CONTRIBUTING.md
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
git add <files>
git commit -m "type(scope): description"      # commit-msg hook enforces Conventional Commits
git push -u origin feat/short-description     # pre-push hook re-runs test + build
```

Then open the PR against `main` as described in [CONTRIBUTING.md](./CONTRIBUTING.md). Do not bump `version` in `package.json` as part of this flow — see the release process in [AGENTS.md](./AGENTS.md).

## License

[ISC](./LICENSE)
