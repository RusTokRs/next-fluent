# Migrating from next-intl to next-fluent

next-fluent implements the routing and API surface next-intl established, but
formats messages with [Project Fluent](https://projectfluent.org/) instead of
ICU. This guide covers the mechanical migration; the conceptual differences are
at the end.

Everything below was verified against **next-intl 4.14.7** and the current
`next-fluent` build.

## 1. Message format: ICU → Fluent

```jsonc
// messages/en.json (next-intl, ICU)
{
  "greeting": "Hello {name}!",
  "cart": "{count, plural, =0 {Empty} one {One item} other {# items}}"
}
```

```ftl
## messages/en.ftl (next-fluent, Fluent)
greeting = Hello, { $name }!

cart =
    { $count ->
        [0] Empty
        [one] One item
       *[other] { $count } items
    }
```

Two differences worth internalising:

- Fluent is **selector-first**: plurals and genders are expressed with
  `{ $var -> … }` and CLDR category keys (`[one]`, `[other]`), not with a
  `plural` function per key.
- Fluent messages can carry **attributes** (`.label`, `.aria-label`, `.title`),
  which ICU catalogs emulate with extra keys.

### Keeping your JSON catalogs

You do not have to convert on day one. Everywhere next-fluent accepts FTL text
it also accepts a JSON object, and the CLI reads `.json` next to `.ftl`:

```ts
// i18n/request.ts
export default setRequestConfig(async ({ locale }) => ({
  locale,
  messages: (await import(`../../messages/${locale}.json`)).default,
}));
```

Mapping rules: nested objects become `nav-home` (addressable as `t('nav.home')`),
`{count}` / `{$count}` become Fluent variables, and a `""` key defines the
message value while its siblings become attributes:

```jsonc
{ "checkout": { "title": { "": "Checkout", "aria-label": "Checkout page" } } }
```

## 2. Routing configuration

```ts
// src/i18n/routing.ts
import { defineRouting } from 'next-fluent/routing';

export const routing = defineRouting({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePrefix: { mode: 'as-needed', prefixes: { de: '/deutsch' } },
  localeCookie: { name: 'NEXT_LOCALE', maxAge: 31536000, sameSite: 'lax' },
  localeDetection: true,
  alternateLinks: true,
  pathnames: { '/about': { en: '/about', de: '/ueber-uns' } },
});
```

| Option | next-intl | next-fluent |
| --- | --- | --- |
| `locales`, `defaultLocale` | ✅ | ✅ identical |
| `localePrefix: 'always' \| 'as-needed' \| 'never'` | ✅ | ✅ identical |
| `localePrefix: { mode, prefixes }` | ✅ | ✅ identical shape; prefixes are validated (absolute, unique, non-shadowing) |
| `pathnames` (translated routes) | ✅ | ✅ identical shape |
| `domains` | ✅ | ✅ also supports per-domain `localePrefix` overrides (mode or `{ mode, prefixes }`) |
| `localeCookie` | `boolean \| CookieAttributes`, default `{ name: 'NEXT_LOCALE', sameSite: 'lax' }` (session cookie) | `false \| LocaleCookieConfig`, default `{ name: 'NEXT_LOCALE', path: '/', maxAge: 31536000, sameSite: 'lax' }` |
| `localeDetection` | default `true` | default `true` |
| `alternateLinks` | default `true`, emits `Link: <…>; rel="alternate"; hreflang="…"` incl. `x-default` | default `true`; skips redirects and ambiguous URLs, but supports `never` when domains or localized paths produce distinct URLs |

The cookie default is another behavioural difference to check: next-intl writes a
**session** cookie, next-fluent writes a **one-year** cookie. Pass
`localeCookie: { maxAge: undefined }` for session behaviour.

## 3. Middleware

```ts
// middleware.ts (Next 15) or proxy.ts (Next 16)
import { createI18nMiddleware } from 'next-fluent/middleware';
import { routing } from './src/i18n/routing';

export default createI18nMiddleware(routing);

export const config = { matcher: ['/((?!_next|api|.*\\..*).*)'] };
```

next-fluent adds options next-intl does not expose:
`trustedHosts`, `headerName`, `cookieName`, and `pathnames`-aware rewrites that
keep `/ueber-uns` canonical instead of redirecting to `/about`.

## 4. Server API

| next-intl (`next-intl/server`) | next-fluent (`next-fluent/server`) |
| --- | --- |
| `getRequestConfig` | `setRequestConfig` |
| `getTranslations(namespace?)` | `getTranslations(namespace?)` |
| `getLocale()` | `getLocale()` |
| `getMessages()` | `getMessages()` |
| `getFormatter()` | `getFormatter()` |
| `getNow()`, `getTimeZone()` | `getNow()`, `getTimeZone()` |
| `setRequestLocale(locale)` | `setRequestLocale(locale, locales?)` |
| `getExtracted()` | — (Fluent catalogs are the source of truth) |

`setRequestLocale` must be called in **every** page and layout you want
prerendered, exactly as in next-intl. Calling it outside a render throws in
development rather than silently doing nothing.

## 5. Navigation API

```ts
// src/i18n/navigation.ts
import { createNavigation } from 'next-fluent/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

| API | next-intl | next-fluent |
| --- | --- | --- |
| `Link` | `href`, `locale`, all `<a>`/Next props | `href`, `locale`, all `<a>`/Next props |
| `redirect({ href, locale }, type)` | ✅ | ✅ |
| `usePathname()` | prefix stripped, typed against `pathnames` | prefix stripped (custom prefixes included) |
| `useRouter()` | `push`/`replace`/`back`/`forward`/`prefetch` | same |
| `getPathname({ href, locale })` | ✅ | ✅ |

## 6. Using messages

```tsx
// next-intl
const t = await getTranslations('checkout');
t('title');
t('items', { count: 3 });
t.rich('terms', { link: (chunks) => <a href="/terms">{chunks}</a> });

// next-fluent
const t = await getTranslations('checkout');
t('title');
t('items', { count: 3 });
t.rich('terms', { link: (children) => <a href="/terms">{children}</a> });
t.attrs('submit');            // { label: '…', 'aria-label': '…' } — Fluent attributes
t.plain('terms');             // markup stripped, for aria-label/title/meta
```

| next-intl | next-fluent |
| --- | --- |
| `t(key, values)` | `t(key, args)` |
| `t.raw(key)` | `t.raw(key)` (arrays for Fluent attributes/list values) |
| `t.markup(key, values)` | `t.rich(key, values)` |
| `t.has(key)` | `t.has(key)` |
| — | `t.attrs(key)`, `t.plain(key)` |
| `<Translation>` / `useTranslations` | `<FormattedMessage>` / `useTranslations` |

## 7. Types and tooling

```jsonc
// package.json
{ "scripts": { "types": "next-fluent typegen --input messages --output next-fluent.d.ts --watch" } }
```

Or through the Next.js plugin, which regenerates during `next dev`:

```js
// next.config.mjs
import createNextFluentPlugin from 'next-fluent/plugin';
const withNextFluent = createNextFluentPlugin('./src/i18n/request.ts', {
  typegen: { input: './messages', output: './next-fluent.d.ts' },
});
export default withNextFluent({});
```

`next-fluent check` replaces hand-rolled key-diffing scripts:

```bash
next-fluent check --input messages --reference en   # exits non-zero on gaps
```

## 8. What does not carry over

- **ICU-only features**: `selectordinal`, `#` in nested plurals, and relative
  date shorthands are Fluent selectors instead. Fluent has no `#`-style
  "offset" arithmetic — use `{ NUMBER($n, minimumFractionDigits: 2) }`.
- **Extraction from source** (`next-intl/extractor`). next-fluent goes the other
  way: the FTL catalog is the source of truth and types are generated from it, so
  a message that does not exist is a compile error rather than something a scan
  has to discover. The direction that *is* useful is the inverse one —
  `next-fluent check --usage` reports catalog messages no call site references,
  call sites too dynamic to verify, and `t.attrs()` calls on messages without
  attributes. See "Finding dead messages" in the README.
- **`getExtracted()`** — there is no extracted-message store to read.
