# next-fluent

A modern, fast, lightweight localization library for Next.js App Router (React Server Components + Client Components) powered by Mozilla Project Fluent (`.ftl`).

The high-performance Project Fluent alternative to `next-intl`.

## Features

- **Project Fluent Engine**: Full support for Mozilla Fluent syntax, asymmetric localization, terms (`-brand`), complex pluralization (`one`/`few`/`many`), selectors, and variables via official `@fluent/bundle`.
- **First-Class App Router Support**: Strict separation between Server Components (`next-fluent/server`) and Client Components (`next-fluent/client`), fully compatible with React 19.
- **Rich Text & React Node Interpolation** (via `t.rich()` / `<FormattedMessage>`): Pass React components directly into message variables (`{ user: <UserProfile /> }`) and format interactive tags (`<link>docs</link>`, `<br>`). Plain `t()` always returns a string and refuses React-element interpolation.
- **Locale-Aware Routing & Navigation**: Centralized `defineRouting` with localized pathnames (`/about` -> `/about-us` / `/o-nas`), custom domain routing, and automatic URL rewriting without 404s.
- **Next.js Webpack & Turbopack Plugin**: Seamless zero-boilerplate configuration binding via `next-fluent/plugin`.
- **Synchronized Request Snapshot**: `<FluentServerProvider>` passes messages, fallback messages, serializable default values, time zone, and `now` from one server request snapshot to Client Components.
- **Full Type Safety**: Type generation powered by `@fluent/syntax` AST with TypeScript declaration merging (`declare global { interface FluentMessages extends AppMessages {} }`) and automatic namespace key autocompletion.
- **Static Rendering**: `setRequestLocale()` keeps localized routes prerenderable (`●`/`○` in `next build`); the CI fixture asserts it.
- **Production Error Handling**: `onError` / `getMessageFallback` with typed `FluentErrorCode`s instead of hard-coded `console` noise.
- **Cacheable Responses**: the locale cookie is only written on document requests when it actually changes, so static pages stay CDN-cacheable.
- **SEO**: automatic `Link: <url>; rel="alternate"; hreflang="…"` headers (including `x-default`) for every localized route.
- **Bounded LRU Caching**: Resource and bundle caches verify exact source equality even when 32-bit hashes collide.
- **Clean Standards**: Uses standard `NEXT_LOCALE` cookie and `x-next-locale` headers.

---

## Installation

```bash
npm install next-fluent
```

### Supported versions

| | |
| --- | --- |
| Next.js | 15.3 – 16.x (App Router) |
| React | 19+ |
| Node.js | 22+ |
| TypeScript | 5.1+ (required by Next.js 16) |

Both Next.js majors are verified in CI by the same fixture (`npm run test:next`
on 15, `npm run test:next:16` on 16), including the `middleware.ts` → `proxy.ts`
rename and Turbopack being the default bundler for `next build`.

The floor is the **oldest version that still receives updates**, not the newest
one available: Node.js 20 reached end of life on 2026-04-30, so 22 is the oldest
supported LTS, and Next.js 15.3 is where the top-level `turbopack` config landed
(15.0–15.2 needed the old `experimental.turbo` spelling, so that branch is gone
rather than carried). Next.js 15.5.x still receives backports, which is why 15 is
not dropped.

---

## Quick Start

### 1. Next.js Configuration (`next.config.mjs`)

Wrap your Next.js config with `createNextFluentPlugin` to automatically bind your server request config across Webpack and Turbopack:

```javascript
import createNextFluentPlugin from 'next-fluent/plugin';

const withNextFluent = createNextFluentPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withNextFluent(nextConfig);
```

A CommonJS `next.config.js` — still the default in most apps — works too. The
plugin ships a real CJS build whose `module.exports` *is* the factory, so there
is no `.default` to remember:

```javascript
const createNextFluentPlugin = require('next-fluent/plugin');

const withNextFluent = createNextFluentPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = withNextFluent(nextConfig);
```

### 2. Routing Configuration (`src/i18n/routing.ts`)

Define your locales, prefixes, and optional localized URL slugs:

```typescript
import { defineRouting } from 'next-fluent/routing';

export const routing = defineRouting({
  locales: ['en', 'ru', 'de'] as const,
  defaultLocale: 'en',
  // 'always' | 'as-needed' | 'never', or an object with per-locale prefixes:
  // localePrefix: { mode: 'as-needed', prefixes: { 'en-US': '/usa', ru: '/rus' } }
  localePrefix: 'as-needed',
  pathnames: {
    '/about': {
      en: '/about-us',
      ru: '/o-nas',
      de: '/ueber-uns',
    },
  },
});
```

### 3. Server Configuration (`src/i18n/request.ts`)

Configure message catalogs and request-level settings:

```typescript
import { setRequestConfig } from 'next-fluent/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { routing } from './routing';

export default setRequestConfig(async ({ locale }) => {
  const resolvedLocale = routing.locales.find((item) => item === locale) ?? routing.defaultLocale;
  const filePath = path.join(process.cwd(), 'messages', `${resolvedLocale}.ftl`);
  const messages = await fs.readFile(filePath, 'utf-8');

  return {
    locale: resolvedLocale,
    messages,
    timeZone: 'UTC',
    now: new Date(),
  };
});
```

### 4. Proxy or middleware (`proxy.ts` on Next.js 16; `middleware.ts` on Next.js 15)

Enable automatic URL prefixing, internal rewrites for App Router `[locale]` folders, and `Accept-Language` detection:

```typescript
import { createI18nMiddleware } from 'next-fluent/middleware';
import { routing } from './src/i18n/routing';

export default createI18nMiddleware(routing);

export const config = {
  matcher: ['/', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

> **Hardening**: pass `trustedHosts` (e.g. `createI18nMiddleware({ ...routing, trustedHosts: ['example.com', '*.example.com'] })`) to reject foreign `Host` headers with `421 Misdirected Request` before any redirect is issued — recommended when responses may be cached by shared caches or CDNs.

### 5. Root Layout (`app/[locale]/layout.tsx`)

```tsx
import { notFound } from 'next/navigation';
import { FluentServerProvider } from 'next-fluent/server-provider';
import { setRequestLocale, getStaticParams } from 'next-fluent/server';
import { hasLocale } from 'next-fluent';
import { routing } from '@/i18n/routing';

export function generateStaticParams() {
  return getStaticParams(routing.locales); // [{ locale: 'en' }, { locale: 'ru' }, …]
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale, routing.locales);

  return (
    <html lang={locale}>
      <body>
        <FluentServerProvider locale={locale}>
          {children}
        </FluentServerProvider>
      </body>
    </html>
  );
}
```

> **Static rendering.** Next.js renders layouts and pages independently, so `setRequestLocale(locale)` must be called in **every page and every layout** that should be prerendered — not only in the root layout. Without it, `getTranslations()` falls back to reading request headers and the route silently opts into dynamic rendering (the CI fixture fails the build if any localized route stops being prerendered).

Custom Fluent functions and callback-based rich values must be registered in a Client Component because React cannot serialize functions across the server/client boundary. For consistent date formatting, use `FluentServerProvider` or await `getRequestConfigSnapshot()` before calling the synchronous `getNow()` and `getTimeZone()` helpers.

### 6. Navigation Helpers (`src/i18n/navigation.ts`)

Create type-safe, locale-aware navigation components and hooks:

```typescript
import { createNavigation } from 'next-fluent/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname, config } =
  createNavigation(routing);
```

Every URL builder takes `forcePrefix`, which adds the locale prefix even for the
default locale — useful when a link must be unambiguous regardless of the
visitor's stored locale:

```tsx
<Link href="/about" locale="en" forcePrefix>…</Link>  {/* /en/about in as-needed */}
getPathname({ href: '/about', locale: 'en', forcePrefix: true }); // '/en/about'
```

It is a no-op in `localePrefix: 'never'`, where prefixed URLs do not exist.
`redirect()` accepts both `redirect(url, { locale })` and next-intl's
`redirect({ href, locale, forcePrefix }, type)`, so migrating call sites does not
require rewriting them.

---

## Usage in Components

### Server Components (RSC)

```tsx
import { getTranslations } from 'next-fluent/server';

export default async function StorePage() {
  const t = await getTranslations('Storefront');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('welcome', { name: 'Alice' })}</p>
    </main>
  );
}
```

### Client Components

```tsx
'use client';

import { useTranslations, useLocale } from 'next-fluent/client';
import { Link } from '@/i18n/navigation';

export function Navigation() {
  const t = useTranslations('nav');
  const locale = useLocale();

  return (
    <nav>
      <span>Current: {locale}</span>
      <Link href="/about">{t('about')}</Link>
    </nav>
  );
}
```

### Rich Text & React Node Interpolation

Pass React components directly into variables or map interactive markup tags:

```ftl
# messages/en.ftl
welcome-banner = Welcome, { $avatar } { $name }! Visit our <terms>Terms</terms> or <help>Help Center</help>.
multiline = Notice:<br>Please read carefully.
```

```tsx
const content = t.rich('welcome-banner', {
  name: user.name,
  avatar: <UserAvatar user={user} />,
  terms: (chunks) => <Link href="/terms" className="underline">{chunks}</Link>,
  help: <HelpBadge />,
});
```

### `t()` / `raw()` contract

- `t(key, args?)` returns a **string**. If the formatted result still contains a React-element placeholder (e.g. `defaultTranslationValues` injected JSX), it throws and directs you to `t.rich()` / `<FormattedMessage>`. Fluent formatting errors fall back to `namespace.key`.
- `t.rich(key, args?)` and `<FormattedMessage />` are the only APIs that produce React nodes. Tags in messages are **attribute-free** (`<link>docs</link>`, `<br/>`); attributes belong on the component you pass in. Unsupported markup such as `<a href="…">` is left as escaped text rather than turned into HTML.
- `t.attrs(key, args?)` returns **every attribute of a message in declaration order** — `{ label, 'aria-label', title }` — for spreading onto an element. Bidi isolation marks are stripped, since attribute values belong in HTML attributes.
- `t.plain(key, args?)` returns the message as **plain text**: rich-text markers (`<link>…</link>`, React element tokens) and bidi isolation marks are removed instead of throwing. Use it for `aria-label`, `title`, `alt` and `<meta>` content that shares a message with the visible UI — the marks are invisible but they do end up in the rendered attribute.
- `raw('title')` → `string`, `raw('title', { $name: 'Ada' })` → interpolated `string`, `raw('list')` → ordered `string[]` (both Fluent `[]`-lists and JSON arrays). Missing messages fall back to the key; formatting errors are ignored and the literal `{$placeholders}` remain.
- Message arguments accept strings, numbers, booleans (`true` → `"true"`, Fluent has no boolean type), `Date`, `bigint` and `FluentType` values. `null`/`undefined` and non-Fluent objects are reported through `onError` as `INVALID_ARGUMENT` instead of being silently dropped.

### JSON catalogs

Fluent catalogs are `.ftl` text, but every place that accepts FTL text also
accepts a plain object — `FluentProvider messages`, `setRequestConfig({ loadMessages })`,
`getTranslations({ messages })` and the CLI (`.json` files next to `.ftl`):

```tsx
<FluentProvider locale={locale} messages={{ 'nav-home': 'Home', greeting: 'Hi {name}!' }}>
```

Mapping rules:

| JSON | FTL |
| --- | --- |
| `{ "nav": { "home": "Home" } }` | `nav-home = Home` (addressable as `t('nav.home')` or `t('nav-home')`) |
| `{ "hello": "Hi {name}!" }` / `{ $name }` | `hello = Hi { $name }!` |
| `{ "btn": { "": "OK", "aria-label": "Confirm" } }` | `btn = OK` + `.aria-label = Confirm` |
| numbers / booleans | stringified |
| arrays, `null` | rejected with an actionable error (Fluent uses selectors, not lists) |

Braces, quotes, backslashes, padding and newlines are escaped so a converted
catalog round-trips byte for byte.

### Sending a client component only what it renders

```tsx
import { pickMessages } from 'next-fluent/messages';

<FluentProvider
  locale={locale}
  messages={pickMessages(await getMessages(locale), 'checkout')}
/>
```

`pickMessages` prunes the catalog to one namespace — plus the shared Fluent
terms (`-brand`) that namespace references — so the serialized payload scales
with the page instead of the app.

### Error handling (`onError` / `getMessageFallback`)

Route missing or unformattable messages into your own monitoring instead of the console:

```ts
import { setRequestConfig } from 'next-fluent/server';
import { FluentErrorCode } from 'next-fluent';

export default setRequestConfig(async ({ locale }) => ({
  locale,
  messages: await loadCatalog(locale),
  onError(error) {
    if (error.code === FluentErrorCode.MISSING_MESSAGE) console.warn(error.message);
    else reportToSentry(error); // FORMATTING_ERROR, INVALID_ARGUMENT, UNSUPPORTED_VALUE
  },
  getMessageFallback({ namespace, key, error }) {
    return error.code === FluentErrorCode.MISSING_MESSAGE ? `${namespace ?? ''}${key}` : '⚠︎';
  },
}));
```

Missing and formatting errors are logged by default (`console.warn` / `console.error`); pass `onError() {}` to silence them completely. A throwing handler can never break a render. `debug: true` on `getTranslations()`/`createTranslator()` keeps the development-friendly `[MISSING: namespace.key]` output.

### Named formats

Define `Intl` presets once and address them by name from `useFormatter()` / `getFormatter()`:

```ts
export default setRequestConfig(async ({ locale }) => ({
  locale,
  messages: await loadCatalog(locale),
  timeZone: 'Europe/Berlin',
  formats: {
    dateTime: { short: { dateStyle: 'short' }, long: { dateStyle: 'full', timeStyle: 'short' } },
    number: { percent: { style: 'percent' }, eur: { style: 'currency', currency: 'EUR' } },
    list: { bullets: { type: 'conjunction' } },
  },
}));
```

```tsx
const format = useFormatter();
format.dateTime(order.createdAt, 'short'); // named preset
format.number(0.19, 'percent');            // → "19%"
format.dateTime(new Date(), { dateStyle: 'full' }); // raw Intl options still work
```

### Non-HTML output (`useIsolating`)

Fluent wraps placeables in U+2068/U+2069 bidi isolates — correct for HTML, noise in `<title>`, meta tags, JSON APIs or plain-text emails. Turn them off per request (or per call) with `useIsolating: false` in the request config or in `getTranslations()` options. `t.raw()` always strips them.

### Middleware options

```ts
createI18nMiddleware({
  ...routing,
  trustedHosts: ['example.com', '*.example.com'], // 421 for foreign Host headers
  localeCookie: { name: 'NEXT_LOCALE', sameSite: 'lax', secure: true, maxAge: 31536000 },
  // localeCookie: false  → never write the cookie (URL-only locale)
  localeDetection: true,  // false → ignore cookie + Accept-Language
  alternateLinks: true,   // Link: <url>; rel="alternate"; hreflang="…" (+ x-default)
});
```

The cookie is only written for `Sec-Fetch-Dest: document` requests and only when the stored value changes, so prerendered pages keep `Cache-Control: s-maxage=…` instead of being invalidated on every hit.

---

## Type Safety & Autocompletion

Generate full TypeScript definitions from your `.ftl` catalogs using AST-based typegen:

```bash
# --input defaults to ./messages, ./locales, ./src/messages or ./src/locales
npx next-fluent typegen --output src/types/i18n.d.ts --watch
```

Or let the Next.js plugin regenerate during `next dev`:

```js
// next.config.mjs
import createNextFluentPlugin from 'next-fluent/plugin';

const withNextFluent = createNextFluentPlugin('./src/i18n/request.ts', {
  typegen: { input: './messages', output: './src/types/i18n.d.ts' },
});

export default withNextFluent({});
```

The generator produces a declaration merging interface:

```typescript
// src/types/i18n.d.ts (auto-generated)
declare global {
  interface FluentMessages extends AppMessages {}
}
```

Once declared, `useTranslations('namespace')` and `getTranslations('namespace')` **automatically autocomplete message keys and validate arguments** across your entire project!

### Catalog consistency in CI

```bash
npx next-fluent check --input messages --reference en
# [next-fluent] Checked 3 catalog(s) against "en" (412 keys).
#   ru:
#     [missing] "checkout-total" is missing.
#   de:
#     [duplicate] "nav-home" is defined more than once; Fluent keeps the first definition.
# [next-fluent] 2 issue(s) found.
```

Missing, extra, duplicated and unparsable keys are reported per locale and the
command exits non-zero, so translation gaps fail the build instead of shipping a
fallback string. The same engine is available programmatically as
`checkCatalogs()` from `next-fluent/check`.

### Finding dead messages

`next-intl extract` scans your code because there the code is the source of
truth and the JSON catalog is a hand-maintained shadow. next-fluent is inverted:
the catalog is the source of truth and `typegen` derives types from it, so
`t('unknown')` never compiles in the first place. What types *cannot* tell you is
the other direction — which messages nobody renders any more. `--usage` answers
that:

```bash
npx next-fluent check --input messages --src app --usage
# Usage against en: 41/52 keys used, 3 dynamic call site(s).
#
# missing (1)
#   "checkout-totl" is used in app/checkout/page.tsx but is missing from en. (app/checkout/page.tsx:18)
#
# dynamic (3)
#   Key is not a string literal and cannot be checked statically. (app/list/item.tsx:9)
#
# unused (8)
#   "legacy-banner" is defined in en but never referenced in the scanned sources.
```

| Finding | Meaning | Severity |
| --- | --- | --- |
| `missing` | a literal key is used but absent from the reference locale | fails the command |
| `missing-attributes` | `t.attrs(k)` / `t.plain(k)` on a message with no attributes | fails the command |
| `dynamic` | `t(key)` or `` t(`x-${id}`) `` — unverifiable statically, listed for review | advisory |
| `unused` | a catalog key no call site references — a safe-delete candidate | advisory |

Advisories never fail the build; pass `--strict-usage` to make them fail, or
`--allow-unused` to skip the dead-key report entirely. Because a false "unused"
is the classic way to lose trust in such a tool, the analyzer is deliberately
conservative: it resolves keys through the same candidate list the runtime uses
(`useTranslations('checkout')` + `t('total')` finds both `checkout-total` and
`checkout.total`), it counts every attribute of a message behind `t.attrs()`,
and anything it cannot resolve is reported as `dynamic` rather than guessed at.
A single call site can be exempted with a `// next-fluent-ignore` comment, whole
namespaces with `--ignore-unused <prefix>`.

The analyzer never writes to a catalog. It is also available programmatically as
`analyzeUsage()` / `formatUsageReport()` from `next-fluent/usage`.

---

## API surface (next-intl parity map)

| next-intl | next-fluent | Notes |
| --- | --- | --- |
| `useTranslations` / `getTranslations` | ✅ same names | Fluent `.ftl` instead of ICU JSON |
| `t.rich()` / `FormattedMessage` | ✅ same names | Fluent markup + React element variables |
| `t.markup()` | `t.rich()` | Fluent has no ICU-HTML duality |
| — | `t.attrs()` / `t.plain()` | Fluent attributes; markup-free text for HTML attributes |
| `useLocale` / `getLocale` | ✅ | |
| `useMessages` / `getMessages` | ✅ | returns the raw FTL catalog |
| `useFormatter` / `getFormatter` | ✅ | plus named `formats` presets |
| `useNow` / `getNow`, `useTimeZone` / `getTimeZone` | ✅ | request snapshot keeps SSR/CSR identical |
| `NextIntlClientProvider` | `FluentServerProvider` / `FluentProvider` | forwards messages, fallback, `now`, `timeZone`, defaults |
| `onError` / `getMessageFallback` / `IntlErrorCode` | ✅ `FluentErrorCode` | server *and* client |
| `setRequestLocale` | ✅ | required in every page + layout for static rendering |
| `hasLocale` | ✅ | canonical, case-insensitive |
| `getRequestConfig` | `setRequestConfig` | |
| `createNextIntlPlugin` | `createNextFluentPlugin` | Webpack + Turbopack config alias |
| `defineRouting` (`pathnames`, `domains`, `basePath`, `localePrefix`) | ✅ | |
| `localeCookie`, `localeDetection`, `alternateLinks` | ✅ | |
| `localePrefix.prefixes` (per-locale prefix map) | ✅ | validated: absolute, unique, non-shadowing |
| `createNavigation` (`Link`, `redirect`, `permanentRedirect`, `useRouter`, `usePathname`, `getPathname`, `config`) | ✅ | `forcePrefix` supported on `Link`, `getPathname`, `redirect` and the router methods; `redirect` also takes next-intl's object form |
| Type-safe messages | ✅ `next-fluent typegen` | AST-based, declaration merging, `--watch` |
| `createMessagesDeclaration` | ✅ plugin `typegen` option | regenerates during `next dev` |
| JSON catalogs | ✅ | accepted wherever FTL text is, plus in the CLI |
| — | `pickMessages()` | prune a catalog to one namespace for client payloads |
| — | `next-fluent check` | cross-locale missing/extra/duplicate/parse report |
| Message extraction from source | ✅ by design | not needed: the catalog is the source of truth, so `t('unknown')` is a compile error. `next-fluent check --usage` covers the other direction — dead keys and unverifiable call sites |

## License

MIT License.
