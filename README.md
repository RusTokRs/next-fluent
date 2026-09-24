# next-fluent

A modern, fast, lightweight localization library for Next.js App Router (React Server Components + Client Components) powered by Mozilla Project Fluent (`.ftl`).

The high-performance Project Fluent alternative to `next-intl`.

## Features

- **Project Fluent Engine**: Full support for Mozilla Fluent syntax, asymmetric localization, terms (`-brand`), complex pluralization (`one`/`few`/`many`), selectors, and variables via official `@fluent/bundle`.
- **First-Class App Router Support**: Strict separation between Server Components (`next-fluent/server`) and Client Components (`next-fluent/client`), fully compatible with React 19.
- **Rich Text & React Node Interpolation**: Pass React components directly into message variables (`{ user: <UserProfile /> }`) and format interactive tags (`<link>docs</link>`, `<br>`).
- **Locale-Aware Routing & Navigation**: Centralized `defineRouting` with localized pathnames (`/about` -> `/about-us` / `/o-nas`), custom domain routing, and automatic URL rewriting without 404s.
- **Next.js Webpack & Turbopack Plugin**: Seamless zero-boilerplate configuration binding via `next-fluent/plugin`.
- **Synchronized Request Snapshot**: `<FluentServerProvider>` passes messages, fallback messages, serializable default values, time zone, and `now` from one server request snapshot to Client Components.
- **Full Type Safety**: Type generation powered by `@fluent/syntax` AST with TypeScript declaration merging (`declare global { interface FluentMessages extends AppMessages {} }`) and automatic namespace key autocompletion.
- **Bounded LRU Caching**: Resource and bundle caches verify exact source equality even when 32-bit hashes collide.
- **Clean Standards**: Uses standard `NEXT_LOCALE` cookie and `x-next-locale` headers.

---

## Installation

```bash
npm install next-fluent
```

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

### 2. Routing Configuration (`src/i18n/routing.ts`)

Define your locales, prefixes, and optional localized URL slugs:

```typescript
import { defineRouting } from 'next-fluent/routing';

export const routing = defineRouting({
  locales: ['en', 'ru', 'de'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed', // 'always' | 'as-needed' | 'never'
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

### 5. Root Layout (`app/[locale]/layout.tsx`)

```tsx
import { notFound } from 'next/navigation';
import { FluentServerProvider } from 'next-fluent/server-provider';
import { setRequestLocale } from 'next-fluent/server';
import { routing } from '@/i18n/routing';

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.some((item) => item === locale)) notFound();
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

Custom Fluent functions and callback-based rich values must be registered in a Client Component because React cannot serialize functions across the server/client boundary. For consistent date formatting, use `FluentServerProvider` or await `getRequestConfigSnapshot()` before calling the synchronous `getNow()` and `getTimeZone()` helpers.

### 6. Navigation Helpers (`src/i18n/navigation.ts`)

Create type-safe, locale-aware navigation components and hooks:

```typescript
import { createNavigation } from 'next-fluent/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

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

---

## Type Safety & Autocompletion

Generate full TypeScript definitions from your `.ftl` catalogs using AST-based typegen:

```bash
npx next-fluent typegen --input messages/en.ftl --output src/types/i18n.d.ts
```

The generator produces a declaration merging interface:

```typescript
// src/types/i18n.d.ts (auto-generated)
declare global {
  interface FluentMessages extends AppMessages {}
}
```

Once declared, `useTranslations('namespace')` and `getTranslations('namespace')` **automatically autocomplete message keys and validate arguments** across your entire project!

---

## License

MIT License.
