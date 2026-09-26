# Contributing to next-fluent

## Development setup

```bash
npm ci
npm run build     # transpiles src/*.ts → dist/*.js (committed, see below)
npm test          # node:test suite
```

`npm run check` runs everything CI runs: build, dist sync, lint, typecheck,
edge-runtime check, unit tests, size budgets, generated consumer types and a
production Next.js build of the fixture app in `test/fixtures/next-app`.

Useful subsets:

| Command | What it verifies |
| --- | --- |
| `npm run lint` | ESLint, including `react-hooks/rules-of-hooks` as an error |
| `npm run typecheck` | `tsc --noEmit` over `src/` |
| `npm run test:types` | `next-fluent typegen` over a real catalog + `tsc` on a consumer file |
| `npm run test:edge` | the middleware graph contains no Node-only code and runs on a Web `Request` |
| `npm run size` | minified/gzip budgets for the client entries |
| `npm run test:next` | builds and boots the fixture app, asserts the prerender manifest and response headers |
| `npm run test:next:browser` | the same, plus hydration in Chromium (requires `npx playwright-cli install-browser chromium`) |

## `dist/` is committed

`dist/` is checked in so the package can be consumed straight from the
repository, and CI fails when it drifts (`git diff --exit-code dist/`).
After changing `src/`, run `npm run build` and commit the result.

## Writing tests

- Tests live in `test/*.test.mjs` and import from `../dist/*.js` — they exercise
  the shipped build, not the sources.
- Prefer the public entry points (`dist/server.js`, `dist/client.js`,
  `dist/middleware.js`) over internals.
- Client paths that need React are rendered with `react-dom/server`
  (`renderToStaticMarkup`), which keeps the suite runnable without a browser.
- Every fix gets a regression test that fails without the fix. When the failure
  mode is a silent fallback, assert on the reported error
  (`onError` / `FluentErrorCode`), not just on the returned string.

## Architecture notes that are easy to break

- **Module boundaries are load-bearing.** `src/index-browser.ts` must stay free
  of `node:*` imports and of `@fluent/syntax` (used by `pseudo.ts`, `typegen.ts`,
  `pick-messages.ts`, `check.ts`, `catalog-io.ts`). `npm run size` and
  `npm run test:edge` guard this.
- **One module instance per realm.** `scripts/build.mjs` transpiles each file
  separately instead of bundling, so caches and the request-config global are
  shared across entry points. Do not switch to a bundled build.
- **The middleware runs twice per rewritten request.** The rewrite signal header
  is what stops the second pass from canonicalizing its own rewrite target; it
  is only honoured where a loop is otherwise possible.
- **Bidi isolation marks.** Fluent inserts U+2068/U+2069 around placeables.
  Tests that compare strings should strip them (`value.replace(/[\u2068\u2069]/g, '')`)
  rather than disabling `useIsolating`, so the default path stays covered.

## Release checklist

1. `npm run check` passes locally.
2. Update `CHANGELOG.md`.
3. Bump the version in `package.json`, commit, tag, push.
