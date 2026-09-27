# Changelog

All notable changes to `next-fluent` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

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

### Fixed

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
