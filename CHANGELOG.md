# Changelog

All notable changes to `next-fluent` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- **Multi-domain browser regression.** `npm run test:next:domains` exercises a
  production Next app behind a TLS reverse proxy using Chromium: all prefix
  strategies, custom prefixes, basePath, Link/router switches, cookies and
  alternate links. Runs against Next 15 and 16 in CI.

- **Per-domain `localePrefix`.** Domain entries accept the same mode or
  `{ mode, prefixes }` configuration as the global setting, overriding it in
  full. Middleware, navigation, locale switching and alternate links use the
  destination domain's prefixes and default locale. Overrides are validated
  against the domain's locales; omitted overrides inherit the global setting.

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
- **The client size budget measures what an app imports, not the package root.**
  Bundling the root entry as an entry point kept code no visitor downloads
  (every module is re-exported there), which overstated the client by 1.7 kB
  minified / 0.7 kB gzip and quietly eroded the budget across three passes. The
  budget now bundles `test/fixtures/size/client-consumer.ts`, which imports the
  documented client API through the published specifiers, and a test fails when
  a new client export is missing from it. Budgets were re-baselined accordingly
  (47.0 kB minified / 15.9 kB gzip measured for the client surface).

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

- **`next-fluent check --usage` no longer invents verdicts.** Six call shapes
  were read wrongly, and every one of them produced a *false* finding — the
  `missing` and `unused` kinds that fail the command:
  `<FormattedMessage id="checkout-title" />` was not scanned at all, so a key
  used only through the component was reported as dead (and a non-literal `id`
  vanished silently instead of being listed for review); a block comment after
  the key (`t('key' /* why */)`) made the argument unreadable and the key
  *dynamic*; `createTranslator(bundle, 'checkout')`,
  `createTranslator(bundle, { namespace: 'checkout' })` and
  `createTranslator(bundle, null, 'checkout')` read the namespace from the first
  argument only, so the binding looked global and `t('total')` was reported as
  missing; a namespace that exists but is not a literal
  (`useTranslations(NAMESPACES.checkout)`) was resolved as if the translator were
  global, reporting a key nothing matches as missing instead of unverifiable; a
  concatenation (`t('check-' + suffix)`) was matched greedily into the literal
  key `check-' + suffix` — a key no catalog can hold — and reported as missing
  while the real keys were called unused; `t('key' as const)` and
  `t('key' satisfies Key)` were classified as unverifiable even though the
  compiler erases the assertion and the value is exactly that literal. Optional
  calls (`t?.('key')`, `t?.rich('key')`, `t.rich?.('key')`) are call sites now
  too, instead of being invisible.
- **A route can no longer reach another origin through the characters a URL
  parser removes.** Browsers strip ASCII tab, LF and CR from a URL before
  parsing it, so `href: "/\n/evil.example"` is not a path with a newline in it —
  it is protocol-relative `//evil.example`. The leading separator run was
  collapsed before the browser's own reading of the string was modelled, so in
  the `as-needed` and `never` modes the crafted href reached the DOM unchanged
  and resolved to a different host. `normalizeLeadingSlashes` now removes the
  discarded characters first, which also keeps a `basePath` strip behaving the
  same for the crafted and the clean spelling.
- **A valid `timeZone` is no longer reported as unknown when the *options* were
  the problem.** `Intl.DateTimeFormat` throws for an unusable configuration as a
  whole, and `{ dateStyle: 'short', timeZoneName: 'short' }` — a combination
  ECMA-402 forbids — was reported as "Unknown time zone `UTC`", sending the
  reader after a config value that was correct. The zone is now probed on its
  own: when it is fine, the style is dropped so the value still renders as
  localized text, and the warning names the rule. Errors with no such rescue
  (an out-of-range `hourCycle`, say) are reported as refused instead.
- **An internal path can no longer resolve to another origin.** `resolveLocalizedPathname`
  normalizes Windows backslashes to `/`, but the leading run of separators that
  this creates was only collapsed on the prefix branch. In `localePrefix:
  'as-needed'` for the default locale (and in `'never'`) `href: '/\\evil.example'`
  reached the DOM as `//evil.example` — a protocol-relative link to another
  host — and the same happened after a `basePath` strip. The run is now collapsed
  before locale matching, so every mode produces an internal path.
- **A URL object's `port` is validated.** `absoluteUrlFromObject` interpolated the
  port verbatim, so `{ hostname: 'example.com', port: '@evil.com' }` produced
  `https://example.com:@evil.com/a`, which the URL parser reads as userinfo plus
  the host `evil.com`: the link pointed at another origin. Non-numeric ports now
  throw instead of building a different authority.
- **An unknown `timeZone` no longer prints ISO strings.** A typo in
  `requestConfig.timeZone` (or in per-call options) made `Intl.DateTimeFormat`
  throw, and `dateTime()` silently fell back to `date.toISOString()`. The
  formatter now reports the zone once and retries without it, so the output stays
  localized; the fallback formatter is cached, so a misconfiguration costs
  nothing per render.
- **A byte-order mark no longer costs the first catalog entry.** Neither Fluent
  parser treats U+FEFF as whitespace: a catalog saved with a BOM silently lost
  its first message, in the runtime and in `typegen`/`check`/`pseudo` (and a JSON
  catalog failed with a bare "Unexpected token"). The mark is stripped in the
  shared funnel (`createFluentBundle`, `getOrCreateResource`, `parseFtl`,
  `readCatalog`); both spellings now share one cache entry.
- **Entries the runtime parser drops are reported with their ids.** A message
  with a syntax error disappears from `FluentResource` without a trace, so
  `t('that.key')` reported MISSING_MESSAGE for a key the catalog defines. The
  server runtime now names the lost entries once per catalog and points at
  `next-fluent check`; the scan lives in the server-only
  `src/catalog-integrity.ts`, so it costs the client bundle nothing.
- **FluentType-shaped values from another package copy work.** A `FluentNumber`
  from a second copy of `@fluent/bundle` (or any application value object) was
  passed to Fluent as a foreign object and failed with "Variable type not
  supported"; plain data objects like `{ value: 1 }` also slipped through that
  check and produced a formatting error instead of a clear `INVALID_ARGUMENT`
  naming the argument. Such values are now unwrapped to the primitive the local
  copy formats, and plain objects are reported as invalid arguments.
- **`getRequestConfigSnapshot(locale)` no longer replaces the request locale.**
  The snapshot wrote its locale into the request store, so a later `getLocale()`
  in the same render returned the snapshot's locale instead of the request's.
  `timeZone`/`now` still come from the snapshot, which is what the synchronous
  `getNow()`/`getTimeZone()` helpers read.
- **Cyclic `Intl` options no longer overflow the stack.** The formatter cache key
  serialized options recursively, so an object graph with a cycle crashed the
  render with `RangeError: Maximum call stack size exceeded`. The serializer now
  tracks the current path.
- **A domain configured as `example.com.` is matched.** The middleware compared
  the normalized request host against the raw configured spelling, so an
  absolute (dotted) domain silently stopped applying and global rules were used
  instead.

- **Generated types follow the runtime's key resolution.** When a message is
  named like another message's dotted attribute (`greeting-formal` next to
  `greeting` with `.formal`), `t('greeting.formal')` formats the message — the
  dashed id is resolved first — but `typegen` declared the attribute's
  arguments, so the type check pointed callers at the wrong variables and the
  call formatted to the key. The key now carries the winner's arguments and the
  generated file names the shadowed attribute and its `t.attrs()` path.
- **`trustedHosts` wildcards list subdomains only.** `*.example.org` no longer
  accepts the apex: an allow-list that quietly admits a host the operator did
  not write down is the wrong default for a control whose job is rejecting
  foreign `Host` values. Add `example.org` next to the wildcard when the apex is
  served too — the README example already does.
- **A forged `x-forwarded-host: localhost:3000` no longer rewrites the origin.**
  The loopback exception is for local development proxies, so it now requires
  the connection itself to come from loopback; a public request that merely
  claims the header no longer makes redirects and alternate links point at
  `localhost`.
- **`next dev` warns about an unverified `Host` for alternate links too.** The
  one-time warning used to fire only when a redirect was built, although the
  `Link` header takes its origin from the same header. It now covers both.
- **`localeDetection: false` stops writing the locale cookie.** Nothing read it
  back, so the default `Set-Cookie` on the first response of every visitor only
  made documents uncacheable. An explicit `localeCookie` config remains an
  opt-in (e.g. to keep `getLocale()` working on routes the matcher excludes).
- **`pickMessages` keeps the messages a namespace interpolates, not just its
  terms.** `checkout-title = Buy { common-greeting }` produced a pruned catalog
  without `common-greeting`: the client bundle then rendered `checkout-title`
  itself and reported `FORMATTING_ERROR: Unknown message`. References are now
  followed transitively (`{ -term }` and `{ message }`, from messages and from
  kept terms), in source order, and each entry is emitted once even when it is
  referenced several times or by itself.
- **Unparsable catalog entries are no longer dropped in silence.** The FTL
  parser does not throw on a broken message — it puts the text into a `Junk`
  node — and the serializer drops junk by default, so `check` reported the
  problem while `typegen`, `pseudo` and `pickMessages` quietly emitted an
  artifact without the message. `typegen` and `pseudo` now fail with the first
  line of every unreadable entry, and `pickMessages` does so when the entry
  belongs to the requested namespace (junk of other namespaces is pruned by
  design).
- **A JSON catalog cannot declare one message id twice.** `{ "nav-home": … }`
  and `{ "nav": { "home": … } }` both convert to `nav-home`; the second
  definition silently replaced the first at runtime and the key disappeared from
  generated types. Conversion now reports both JSON paths and refuses the
  catalog.
- **Literal braces have an escape hatch in JSON catalogs.** `{count}` stays an
  interpolation (ICU/next-intl compatibility), but `has {braces}` used to become
  `$braces` and render as the key. `\{` and `\}` now mean literal braces in
  every JSON value.
- **`Accept-Language: en;q=0,*` no longer negotiates English.** RFC 9110 §12.5.4
  defines `q=0` as "not acceptable"; the wildcard branch ignored it and could
  select a locale the client explicitly refused. A `q=0` entry now excludes that
  locale from the wildcard, whether it appears before or after the `*`.
- **The usage analyzer reports deep nesting and keeps line numbers aligned.**
  `indexCatalog` parsed with the raw parser, so a deeply nested catalog crashed
  with "Maximum call stack size exceeded" while every other consumer reported an
  actionable error; and a `\`+newline line continuation inside a template
  literal swallowed the newline, shifting every later diagnostic in that file by
  one line.
- **The catalog watcher reports an unwatchable directory.** `fs.watch` on a
  missing path throws on Linux/Node 22 but returns a silent, never-firing
  watcher on Node 24 and Windows — so `next dev` could stop regenerating types
  without a word, and an asynchronous watcher error crashed the process because
  nothing listened for it. `watchCatalogs` now stats the directory up front and
  reports through `onError`, and the watcher has an `'error'` handler.
- **One redirect instead of two when the locale is detected.** A visitor with
  `Accept-Language: ru` asking for a shared slug (`/about-us`) was sent to
  `/ru/about-us` and only then to the canonical `/ru/o-nas`. Detection and slug
  canonicalization now happen in the same hop.
- **Detection-derived responses carry `Vary: Accept-Language, Cookie`.** The
  target of a prefix-less request depends on the cookie and the header, and a
  shared cache that ignored them could replay one visitor's language to the
  next. Prefixed URLs are unaffected and stay cacheable.
- **`Secure` on the locale cookie in production.** The default cookie options
  are now `{ path: '/', maxAge: 31536000, sameSite: 'lax', secure: NODE_ENV ===
  'production' }` and remain overridable through `localeCookie`.
- **`next dev` warns when `trustedHosts` is missing.** Redirect targets are
  built from the request's `Host` header in that case; the warning fires once on
  the first redirect and never in production.
- **Catalog file names are locales again, not namespace labels.**
  `messages/en-app.json` used to become a locale called `en-app` — it was
  compared against the real locales, and because it sorted first it was even
  elected as the reference. The locale is now the longest valid tag prefix of
  the name (`en-app` → `en`, `pt_BR.ftl` → `pt-BR`), so a namespaced catalog
  joins its locale, and `check` compares `en` with `ru`.
- **URL objects keep the origin they were given.** `{ href: '/docs' }` used to
  resolve to `/`, and `{ protocol, host/hostname }` was silently rewritten to the
  current origin. A relative `href` is now a path shorthand, an absolute URL
  object is honored, and an unsupported protocol (`javascript:`) or a host
  carrying path characters is rejected instead of leaking.
- **Bundles built with custom Fluent functions are cached per functions
  object.** A module-level functions table (or the stable identity
  `FluentProvider` now keeps) no longer re-parses the catalog on every render or
  request; `clearBundleCache()` still invalidates them.
- **Alternate links no longer repeat route parameters in the query.**
  `/ru/dokumenty/7?id=7` advertised `?id=7` on every variant; parameters consumed
  by the pathname are dropped, exactly like `resolveLocalizedPathname` does
  for hrefs.

- **`t.has()` answers whether the key is renderable.** A Fluent message may
  define attributes only (`id =` with `.attr = …` and no value); `t()` cannot
  format it, but `has()` used to report `true`, so `<FormattedMessage fallback>`
  rendered the raw key instead of the fallback. `has()` now matches what `t()`
  can resolve — `true` for messages with a value and for attribute paths,
  `false` for value-less ids and missing keys. The usage analyzer already
  treats `t.has()` probes as legitimate references.
- **The middleware rewrite signal is no longer forgeable.** The second pass
  Next.js performs after `NextResponse.rewrite()` is recognized by
  `x-next-fluent-rewrite` **plus** a random per-process token, so a request that
  merely guesses the pathname (`GET /en/about` with
  `x-next-fluent-rewrite: /en/about`) can no longer pin the internal alias as a
  non-canonical duplicate — it canonicalizes to `/about-us` again under both
  Next 15 and Next 16. Loop prevention is unchanged: the genuine second pass
  still carries the signal, and the `sec-fetch-dest` fast path still covers the
  router fetches Next 16 performs for client-side navigations. The internal
  headers never reach the application.

- **Deeply immutable routing definitions.** `defineRouting()` copies and freezes
  supported nested settings instead of sharing mutable prefix maps, pathnames,
  domain entries, cookie options and trusted hosts with the caller. The copied
  values are validated before returning; caller-owned data stays mutable.
  Return types are deeply readonly without losing locale/route inference.
  Input mutations can no longer desynchronize navigation and middleware.

- **Implicit locale-prefix conflicts fail at configuration time.** Validation
  now checks the effective prefix map, including `/{locale}` defaults, instead
  of only explicit overrides. Domain checks use the global locale spelling
  (including aliases such as `pt_br` → `pt-BR`); separate hosts can reuse a prefix.
- **Deterministic route specificity.** Static segments outrank single dynamic
  segments, then required and optional catch-alls; earlier segments take
  precedence over the total static-segment count. Localized templates are ranked
  separately from internal fallbacks. Explicit parameterized template hrefs
  retain their identity. Regression tests cover all 120 orders of five
  overlapping routes, plus middleware/hreflang and Next 15/16 browser navigation.

- **Prefix-table cache no longer retains temporary navigation configs.** Both
  cache levels now use weak keys, so a long-lived locales array cannot keep all
  previously normalized prefix maps alive. A GC regression exercises this
  lifetime directly while verifying live cache entries still work.
- **Custom-prefix normalization avoids repeated full-map scans.** Each custom
  key is resolved once per normalization instead of once per configured locale;
  alias lookup, first-match precedence and fallback prefixes remain unchanged.

- **Custom-prefix rewrites now use real locale segments.** Public `/lang/ru`
  prefixes rewrite to `/ru` for `app/[locale]`, even for roots and untranslated
  paths. `usePathname` also recognizes the internal locale segment after a
  rewrite; router fetches settle without redirect loops.
- **Real NextRequest and reverse-proxy routing.** Preserve `nextUrl.basePath`
  when Next has already stripped it from `pathname`. Internal rewrites stay on
  Next's original request origin instead of becoming external proxy requests
  to the public host.
- **Absolute domain links persist explicit locale switches.** Links/router
  methods targeting configured multi-locale domains now carry the temporary
  switch prefix when needed. Old locale cookies no longer undo a switch to a
  prefix-less default or a shared path in `never` mode.

- **Alternate links in `never` mode.** Distinct domain/localized-path URLs now
  produce hreflang links instead of being suppressed unconditionally. Ambiguous
  URLs are excluded, and single-locale domains still advertise other configured
  domains. Each destination's prefix strategy is respected.
- **Domain matching behind non-standard ports.** Replacing a request or redirect
  host now explicitly replaces the port too: a port-less host no longer inherits
  `:3000` (or another old port) from the original WHATWG URL. Explicit destination
  ports are retained, including with trusted forwarded hosts.

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

- **A client catalog that Fluent cannot fully read is now named in development.**
  `@fluent/bundle` drops an unreadable message without an error, so a catalog a
  client component passes to `FluentProvider` (FTL text, FTL sources or a JSON
  payload) rendered that key as its own id with nothing to explain why. The
  provider now scans the catalog like the server runtime does and reports the
  lost ids once; the scan is behind `process.env.NODE_ENV` and therefore absent
  from a production bundle (verified by the size budget, which measures the same
  fixture as a development build and fails if the two collapse to one size).

- **The release dry run broke the Next integration harness.** npm hands its own
  configuration to scripts as `npm_config_*`, so `npm publish --dry-run` set
  `npm_config_dry_run=true` for everything it ran — including the harness's
  nested `npm install` for Next 16, which then reported "added 54 packages"
  while writing nothing, and the run died later on a bare `ENOENT` for
  `node_modules/next/package.json`. The harnesses now build their child
  environments through `scripts/npm-env.mjs`, which drops that namespace and
  keeps everything else; the manual dispatch of the Publish workflow (dry run by
  default) completes end to end again.

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
