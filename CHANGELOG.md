# Changelog

All notable changes to `next-fluent` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- **`forcePrefix`.** `Link`, `getPathname`, `redirect`, `permanentRedirect` and
  the router methods now accept `forcePrefix`, which adds the locale prefix even
  for the default locale — the URL becomes unambiguous regardless of the
  visitor's stored locale. It is a no-op in `localePrefix: 'never'`, where
  prefixed URLs do not exist. Closes the last navigation gap against next-intl.
- **`redirect()` accepts next-intl's call shape.** Both `redirect(url, { locale })`
  and `redirect({ href, locale, forcePrefix }, type)` work, so migrating does not
  mean rewriting every call site. `createNavigation` also returns `config`.
- **Per-locale URL prefixes.** `localePrefix` now accepts the next-intl shape
  `{ mode, prefixes: { 'en-US': '/usa' } }` in addition to the bare
  `'always' | 'as-needed' | 'never'` mode. Prefixes are validated at
  configuration time (absolute path, no trailing slash, unique, not shadowing
  another prefix) and are honoured by the middleware, `getPathname`, `Link`,
  `redirect`, `usePathname` and the `Link` alternates header.
- **`t.attrs(key)`** returns every attribute of a message in declaration order,
  so `<input {...spreadAttrs(t.attrs('login'))} />` no longer needs one lookup
  per attribute. Bidi isolation marks are stripped because attribute values end
  up in HTML attributes.
- **`t.plain(key)`** formats a message to plain text, dropping rich-text markers
  instead of throwing (`t()`) or returning React nodes (`t.rich()`) — for
  `aria-label`, `title`, `alt` and `<meta>` content.
- **JSON catalogs.** Everywhere FTL text is accepted — `FluentProvider
  messages`, `setRequestConfig({ loadMessages })`, `getTranslations({ messages })`,
  `createFluentBundle` and the CLI — a plain object now works too. Nested keys
  become namespaced ids, `{count}` / `{$count}` become Fluent variables, and a
  `""` key defines the message value while its siblings become attributes.
- **`pickMessages(catalog, namespace)`** (`next-fluent/messages`) prunes a
  catalog to one namespace — including the terms that namespace references — so
  Client Components receive only the strings they render.
- **`checkCatalogs()`** (`next-fluent/check`) and the **`next-fluent check`** CLI
  compare every locale against a reference catalog and report missing, extra,
  duplicated and unparsable keys. Exits non-zero so it can gate CI.
- **`next-fluent typegen --watch`**, plus a `typegen` option on
  `createNextFluentPlugin` that regenerates declarations during `next dev`.
  `--input` is now optional (`./messages`, `./locales`, `./src/messages`,
  `./src/locales` are probed) and `.json` catalogs are picked up next to `.ftl`.
- **Edge runtime check** (`npm run test:edge`): bundles the middleware graph for
  a neutral platform, rejects `node:*`/`require`/`next/headers` references and
  executes it against a Web-standard `Request`.
- **Client bundle size budgets** (`npm run size`), enforced in CI.
- **Usage analysis: `next-fluent check --usage`** and `analyzeUsage()` /
  `formatUsageReport()` (`next-fluent/usage`). The inverse of message
  extraction: the catalog stays the source of truth, and the analyzer reports
  what types cannot — catalog keys no call site references (`unused`), call
  sites too dynamic to verify (`dynamic`), literal keys absent from the
  reference locale (`missing`) and `t.attrs()`/`t.plain()` calls on messages
  without attributes (`missing-attributes`). Keys are resolved through the same
  candidate list the runtime uses, every attribute behind `t.attrs()` counts as
  used, `// next-fluent-ignore` exempts a call site and `--ignore-unused
  <prefix>` a namespace. `missing`/`missing-attributes` fail the command;
  advisories only do with `--strict-usage`. The analyzer never writes to a
  catalog.
- `next-fluent check --usage` now works with a single locale. Cross-locale
  comparison still needs a second catalog, but usage analysis does not, so a
  project that ships one locale can already hunt dead messages.

### Changed

- Build-time tools moved out of the app entry points. `pseudoLocalizeFtl` and
  `generateTypeDeclarations` are now imported from `next-fluent/pseudo` and
  `next-fluent/typegen`; `pickMessages` and `checkCatalogs` from
  `next-fluent/messages` and `next-fluent/check`. They pull in `@fluent/syntax`
  (a full FTL parser), which no browser bundle needs — the client entry dropped
  from 68.2 kB to 44.2 kB minified as a result.
- `createFluentBundle`, `FluentProvider`, `loadMessages`, `getMessages` and
  `getTranslations` accept `MessageSource` (`string | readonly string[] | JsonCatalog`).
- `useMessages()` is typed as `MessageSource | undefined`.
- `LRUCache` rejects non-positive and non-integer sizes instead of silently
  behaving like a one-entry cache.

### Changed

- **`peerDependencies.next` is now `>=15.3.0 <17.0.0`** (was `>=15.0.0`). Next
  15.3 is where the top-level `turbopack` option landed; 15.0–15.2 needed the old
  `experimental.turbo` spelling. That made `needsLegacyTurboConfig()` — which
  shelled out to read Next's `package.json` and parse its version on every config
  evaluation — the only version-conditional code left in the library, and it is
  now deleted instead of carried.
- **Node.js 22 stays the floor, deliberately.** No API newer than ES2022 is used
  anywhere in `src/` or `bin/`, and Node.js 20 reached end of life on 2026-04-30,
  so 22 is already the oldest supported LTS. Raising to 24 would exclude apps on
  a runtime supported until 2027-04-30 while unlocking nothing.

### Added

- **`npm run test:next:16`**, wired into `npm run check`. Next.js 16 was
  previously untested: the repository installs Next 15, so the harness branch that
  renames `middleware.ts` to `proxy.ts` never ran and Turbopack — the default
  bundler for `next build` since 16 — was never exercised. The same fixture now
  runs against both majors (`NEXT_FLUENT_NEXT_VERSION` installs the other one
  into the throwaway app). Verified on Next 16.3.6: build under Turbopack with
  the plugin's `webpack` hook present, `proxy.ts` registered as "ƒ Proxy
  (Middleware)", static rendering for `/en`, `/ru`, `/en/about`, `/ru/about`, and
  the runtime redirect/hreflang/cookie checks.
- **`next-fluent/plugin` now works from a CommonJS `next.config.js`.** Until now
  the package was ESM-only, so the config format most Next.js apps actually use
  could not load it. On Node < 22.12 `require('next-fluent/plugin')` threw
  `ERR_REQUIRE_ESM`; on newer Node it returned the module *namespace*, so the
  natural `const createNextFluentPlugin = require('next-fluent/plugin')` failed
  with "is not a function". The plugin now ships a real CJS build (the way
  next-intl does for its own `./plugin`) whose `module.exports` is the factory,
  with `.default` and the named export kept for interop, plus a `plugin.d.cts`
  using `export =` so `import x = require('next-fluent/plugin')` typechecks.
  Only the plugin's six-module dependency closure is duplicated; the app entries
  stay ESM-only.
- **`npm run test:consumer`** — a consumer contract test, wired into `npm run ci`.
  Everything else in the suite runs against the repository, so nothing proved a
  real project could install and use the package. It builds a throwaway consumer
  and checks that every documented entry point resolves and exports what the
  README claims, that every bare import in `dist/` is a declared dependency
  (`next-fluent/config` excepted — the plugin aliases that virtual module), that
  both `next.config.js` and `next.config.mjs` produce a working config whose
  alias points inside the consumer, and that `.mts` and `.cts` consumers
  typecheck under `module: nodenext`. A negative control asserts the typecheck
  harness can still fail.

### Fixed

- **Client-side navigation no longer loops forever on Next.js 16.** Next 16 hands
  a middleware rewrite to the client router as a redirect, where 15 kept it
  transparent. The rewrite target is the *internal* route (`/en/about` for the
  public `/about-us`), so the router requested it and was canonicalized straight
  back — an endless `307` loop for every page with a localized slug, in every
  prefix mode. The internal target is now recognized as a fixed point. Scoped to
  the router's own fetches via `sec-fetch-dest` (Next strips the `RSC` header
  before middleware runs), so a typed-in `/en/about` is still a document
  navigation and still canonicalizes — the internal path never becomes a public
  duplicate.
- **The same loop also survived in `never` mode**, on a path no probe had
  walked: stripping the prefix from the internal target `/en/about` yields
  `/about`, which is not the canonical slug either (`/about-us` is), so the
  router cycled `/en/about → /about → /about-us → /en/about`. Live `curl` traces
  could not see it — curl does not follow `x-middleware-rewrite` — only a
  simulation of Next 16's rewrite-as-redirect did. All three prefix modes are now
  covered by tests that model that behaviour (V3-23/V3-24) plus a negative
  control confirming they fail when the guard is removed.
- **A client-side locale switch now sticks.** Restricting `Set-Cookie` to
  document requests also suppressed it on locale-changing *redirects*, so a
  `<Link locale="en">` navigation redirected without persisting the choice and
  the next prefix-less URL resolved straight back to the old cookie. Redirects
  are now exempt from that guard — persisting the locale is the point of the
  redirect, and a cookie there does not make the target page uncacheable.
  Successful non-document responses still write no cookie.
- **Locale resolution no longer re-canonicalizes the configured locales on
  every request.** `Intl.getCanonicalLocales` ran once per configured locale per
  candidate, so matching the last of 184 locales cost ~113 us against ~29 us for
  the first, and a 200-locale site spent ~3.5 ms per request in the middleware.
  Results are memoized in a bounded map (500 entries, then cleared), including
  negative ones, which also makes repeated garbage in a cookie cheap rather than
  expensive. Matching is now ~14 us regardless of position; the 200-locale
  request dropped to ~2.2 ms, of which ~1.4 ms is building the 200-entry
  hreflang header itself.
- **`matchLocalePrefix` rebuilt and re-sorted the prefix table on every call.**
  The table depends only on the locale list and the prefix config, yet it was
  allocated and sorted per call — several times per request. It is now memoized
  in a `WeakMap` keyed by the identity of both, so it dies with the config. To
  keep that safe, `defineRouting` snapshots and freezes its `locales`, making
  the `readonly` in its type true at runtime.
- **A localized slug no longer loses its own locale.** With `pathnames`, a slug
  belongs to exactly one locale, but the middleware resolved the locale only
  from the prefix, the cookie and `Accept-Language` — never from the URL. So in
  `never` mode (no prefixes) a first visit to `/o-nas` with no cookie resolved
  to the default locale and was redirected to `/about-us`: a shared link to the
  Russian page landed on the English one. A slug owned by exactly one
  *non-default* locale now identifies that locale. The cookie still wins, since
  it records an explicit choice, and the default locale's slug is deliberately
  excluded because it is the generic form an ordinary visit lands on — letting
  it win would pin an `Accept-Language: ru` visitor to English.
- **A `bigint` argument was silently rounded.** It was converted with
  `Number(v)`, so a 64-bit id such as `9007199254740993n` rendered as
  `9,007,199,254,740,992` — the last digit wrong — and anything past the double
  range rendered as `∞`. Bigints now keep their exact digits (`NUMBER()` formats
  them exactly too), and only fall back to the raw digits when the value is
  beyond what `Intl` can represent at all.
- **`FluentNumber` and `FluentDateTime` passed by the caller were rejected.**
  The argument check looked for a `type` property, but `FluentType` instances
  carry `value` and `valueOf`, so every one of them was reported as
  `INVALID_ARGUMENT` and the message fell back to its key. Detection is now
  `instanceof FluentType`, with a shape check as a fallback for projects that
  end up with two copies of `@fluent/bundle`.
- **The request-scoped bundle cache key omitted the requested locale.** The
  slot was keyed by the effective locale, while the messages are loaded for the
  requested one. A request config that normalizes several requested locales onto
  one effective locale (for example `en-GB` and `en` both resolving to `en`)
  could therefore serve the first locale's messages to the others within a
  single request. The key now carries both. This was found by inspection and is
  not covered by a test: it needs a live React request scope, which the unit
  harness does not provide, and the fix only narrows a cache key.
- **`assertSafeHref()` could be bypassed with control characters.** Browsers
  remove ASCII tab, LF and CR anywhere in a URL, and strip C0 controls at the
  edges, before they resolve the scheme — so `java\tscript:alert(1)` executes
  while the raw-string check saw an innocuous path. The guard now tests the URL
  the browser will see. It is exported for validating untrusted hrefs; `Link`
  and `getPathname` were not themselves exploitable, because an unrecognized
  scheme was turned into a relative path, but such an href is now rejected
  outright. The reported href is escaped, so a rejected value cannot rewrite its
  own error line.
- **A broken JSON catalog did not say which file was broken.** `JSON.parse`
  surfaced as a bare `Unexpected end of JSON input`, with no path — in a project
  with a catalog per locale that is not actionable. The error now names the
  file, and covers `jsonToFluent` failures such as excessive nesting too.
- **A symlinked catalog was silently dropped.** `readdirSync(withFileTypes)`
  reports a symlink as neither file nor directory, so a linked `en.ftl` was
  skipped without a word and its messages simply went missing. Symlinks are now
  classified by `stat`, and are only ever treated as files, so a directory
  symlink cannot create a recursion cycle.
- **`t.plain()` leaked bidi isolation marks into HTML attributes.** The marks
  Fluent puts around every placeable are invisible, and `t.plain()` is meant for
  `aria-label`, `title`, `alt` and `<meta>` content. They were only removed when
  the message also contained markup, so the common markup-free case passed them
  straight through. They are now stripped on every path, matching `t.attrs()`.
- **An unknown named format warned on every call.** The documentation promised
  the warning was reported once, but a list render of a thousand rows logged it a
  thousand times. Each unknown name is now reported once per process, bounded.
- **`LRUCache.get()` did not refresh recency for an entry holding `undefined`.**
  No current caller stores `undefined`, but the entry silently stopped being
  treated as recently used and was evicted early.
- **Localized pathnames are now canonicalized.** With `pathnames` configured,
  `/ru/about` and `/ru/o-nas` both served the same page, and a slug belonging to
  another locale (`/en/o-nas`) was served under the wrong locale. Requests are
  now redirected (307) to the slug the resolved locale actually defines, so
  there is exactly one URL per page in every `localePrefix` mode. The redirect
  is skipped on the middleware's own rewrite pass, so it cannot loop.
- **Usage analysis resolved a variable to the wrong namespace when one file
  bound it twice.** Two components in the same file using
  `const t = useTranslations(...)` with different namespaces made the earlier
  call resolve against the later namespace, reporting a *missing key* for code
  that is correct. Bindings are now tracked in source order and resolved by the
  nearest preceding one; a call preceding all of them, where the namespace
  genuinely cannot be determined, is reported as `dynamic` (advisory) instead of
  `missing` (a build failure).
- **Usage analysis no longer reports phantom findings.** A commented-out or
  stringified `t('key')` counted as a real call site (hiding dead keys), and a
  translator received through props produced a *missing-key failure* for a
  namespace the analyzer cannot know — a false positive that fails CI. Call
  sites are now found in a masked copy of the source (comments, strings, regex
  and template literals blanked, `${…}` interpolations kept), a call that cannot
  be attributed to a binding in the file is matched against every namespace and
  reported as unverifiable rather than missing, and an unrelated callable named
  `t` is ignored entirely.
- **Usage analysis was quadratic.** Line numbers were counted from the start of
  the file for every call site: 20 000 call sites took ~7.8 s, now ~0.1 s.
- **Deep nesting no longer surfaces as a bare stack overflow.** `@fluent/syntax`
  recurses per nesting level, so a message with a few thousand nested placeables
  made `check`, `typegen` and `pseudo` die with "Maximum call stack size
  exceeded". `parseFtl()` converts that into `The catalog is nested too deeply
  for the FTL parser. Flatten the message or split it into several.` (the
  original error is kept as `cause`), and `jsonToFluent` rejects JSON nested
  deeper than 32 levels with the same clarity.
- **A CLI flag without its value** (`next-fluent check --input`) reported
  `Unknown option "--input"`. It now says `"--input" requires a value.`
- `checkCatalogs` failures in the CLI are reported as `Error: <message>` instead
  of a raw stack trace.

### Security

- **Open redirect closed.** With `localePrefix: 'never'` (and `'as-needed'` for
  the default locale), a request such as `/ru//evil.example/x` used to produce
  `307 Location: http://evil.example/x`: stripping the prefix left a
  protocol-relative path, and `new URL('//host', origin)` resolves it to another
  origin. `\` behaves as `/` for special schemes, so `/ru/\evil.example/x` worked
  too. Paths derived from the request now collapse a leading run of `/` and `\`,
  and every redirect/rewrite target is asserted to stay on the request origin.
- **`localePrefix.prefixes` rejects traversal segments** (`/..`, `/../evil`,
  `/./en`) at configuration time instead of emitting `Location` headers the
  browser would resolve outside the intended tree.
- **A catalog named `__proto__.ftl` no longer crashes `next-fluent check`**
  (`TypeError: catalogs[locale].push is not a function`); locale maps are now
  null-prototype, so the locale is reported like any other.

### Fixed

- **JSON catalog values containing a carriage return no longer destroy the
  message.** Fluent has no escape for CR (`\u{…}` is not part of the format) and
  a raw CR inside a string literal makes the runtime parser drop the entry
  entirely, so `{"e": "value\r\nmore"}` silently lost `e`. Line breaks are
  normalized to LF and the value becomes a valid multi-line pattern.
- **`next build` no longer hangs when `typegen` is enabled in the plugin.** A
  recursive `fs.watch` keeps the event loop alive even after `unref()` on Linux;
  the plugin now skips watching in production and otherwise polls on an unref'd
  timer.
- The CLI reports catalog and typegen failures as `Error: <message>` instead of a
  raw stack trace.
- `scripts/size-budget.mjs` and `scripts/check-edge-runtime.mjs` resolve the repo
  root with `fileURLToPath`, so they work on Windows (a drive letter made
  `new URL('..', import.meta.url).pathname` produce `/C:/…`).
- `setRequestLocale()` called outside a React request scope now throws in
  development (and warns in production) instead of silently discarding the
  locale — the failure mode was a page prerendered in the default language.
- `t.attrs()` treats a message without attributes as a miss, so a fallback
  bundle that does define them is still consulted.
- Pseudo-localization no longer breaks on nested placeables
  (`{ $count -> [one] { NUMBER($count) } }`): the tokenizer tracks brace depth
  and Fluent string literals instead of matching to the first `}`.
- The CLI no longer falls through into the `pseudo` branch when `typegen --watch`
  keeps the process alive.
