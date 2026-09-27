import test from 'node:test';
import assert from 'node:assert/strict';

import { defineRouting } from '../dist/routing.js';
import { createNavigation } from '../dist/navigation.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import {
  normalizeLocalePrefix,
  matchLocalePrefix,
  prefixForLocale,
  localeNeedsPrefix,
} from '../dist/locale-prefix.js';

const locales = ['en', 'en-US', 'ru'];

function mockRequest(path, headers = {}, cookie) {
  const url = new URL(path, 'http://localhost:3000');
  const all = { host: 'localhost:3000', ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: { get: (name) => (name === 'NEXT_LOCALE' && cookie ? { value: cookie } : undefined) },
    headers: {
      get: (name) => all[name.toLowerCase()] ?? null,
      forEach: (cb) => Object.entries(all).forEach(([key, value]) => cb(value, key)),
    },
  };
}

test('localePrefix helpers resolve custom prefixes longest-first', () => {
  const config = normalizeLocalePrefix(locales, {
    mode: 'always',
    prefixes: { 'en-US': '/usa', ru: '/rus' },
  });

  assert.equal(prefixForLocale('en', config), '/en');
  assert.equal(prefixForLocale('en-US', config), '/usa');
  assert.deepEqual(matchLocalePrefix('/usa/about', locales, config), { locale: 'en-US', rest: '/about' });
  assert.deepEqual(matchLocalePrefix('/en/about', locales, config), { locale: 'en', rest: '/about' });
  assert.deepEqual(matchLocalePrefix('/en', locales, config), { locale: 'en', rest: '/' });
  assert.equal(matchLocalePrefix('/about', locales, config), null);
  assert.equal(matchLocalePrefix('/english/about', locales, config), null);

  // Default /en vs custom /en-us must not shadow each other.
  const shadow = normalizeLocalePrefix(locales, { mode: 'always', prefixes: { en: '/en-us' } });
  assert.deepEqual(matchLocalePrefix('/en-us/x', locales, shadow), { locale: 'en', rest: '/x' });

  assert.equal(localeNeedsPrefix('en', 'en', 'as-needed'), false);
  assert.equal(localeNeedsPrefix('ru', 'en', 'as-needed'), true);
  assert.equal(localeNeedsPrefix('ru', 'en', 'never'), false);
});

test('localePrefix prefixes are validated at configuration time', () => {
  assert.throws(
    () => defineRouting({ locales, defaultLocale: 'en', localePrefix: { mode: 'sometimes' } }),
    /localePrefix\.mode/
  );
  assert.throws(
    () => defineRouting({ locales, defaultLocale: 'en', localePrefix: { prefixes: { fr: '/fr' } } }),
    /unsupported locale/
  );
  assert.throws(
    () => defineRouting({ locales, defaultLocale: 'en', localePrefix: { prefixes: { ru: 'rus' } } }),
    /absolute path/
  );
  assert.throws(
    () => defineRouting({ locales, defaultLocale: 'en', localePrefix: { prefixes: { ru: '/x/' } } }),
    /absolute path/
  );
  assert.throws(
    () =>
      defineRouting({
        locales,
        defaultLocale: 'en',
        localePrefix: { prefixes: { ru: '/same', 'en-US': '/same' } },
      }),
    /Duplicate locale prefix/
  );
  assert.throws(
    () =>
      defineRouting({
        locales,
        defaultLocale: 'en',
        localePrefix: { prefixes: { ru: '/en', 'en-US': '/en/usa' } },
      }),
    /Ambiguous locale prefixes/
  );
});

test('navigation generates custom prefixes for every API', () => {
  const routing = defineRouting({
    locales,
    defaultLocale: 'en',
    localePrefix: { mode: 'always', prefixes: { 'en-US': '/usa', ru: '/rus' } },
    pathnames: { '/about': { en: '/about-us', 'en-US': '/about-us', ru: '/o-nas' } },
  });
  const { getPathname } = createNavigation(routing);

  assert.equal(getPathname({ href: '/about', locale: 'ru' }), '/rus/o-nas');
  assert.equal(getPathname({ href: '/about', locale: 'en-US' }), '/usa/about-us');
  assert.equal(getPathname({ href: '/about', locale: 'en' }), '/en/about-us');
  // as-needed keeps the default locale prefix-free but honors custom prefixes.
  const asNeeded = defineRouting({
    locales,
    defaultLocale: 'en',
    localePrefix: { mode: 'as-needed', prefixes: { ru: '/rus' } },
  });
  const nav2 = createNavigation(asNeeded);
  assert.equal(nav2.getPathname({ href: '/docs', locale: 'en' }), '/docs');
  assert.equal(nav2.getPathname({ href: '/docs', locale: 'ru' }), '/rus/docs');
  // A prefixed href is still recognized when switching back.
  assert.equal(nav2.getPathname({ href: '/rus/docs', locale: 'en' }), '/docs');
});

test('middleware routes custom prefixes and rewrites them internally', async () => {
  const routing = {
    locales,
    defaultLocale: 'en',
    localePrefix: { mode: 'always', prefixes: { 'en-US': '/usa', ru: '/rus' } },
    pathnames: { '/about': { en: '/about-us', 'en-US': '/about-us', ru: '/o-nas' } },
  };
  const mw = createI18nMiddleware(routing);

  const localized = await mw(mockRequest('/rus/o-nas'));
  assert.equal(new URL(localized.headers.get('x-middleware-rewrite')).pathname, '/ru/about');
  assert.equal(localized.headers.get('x-next-locale'), 'ru');

  const usa = await mw(mockRequest('/usa/about-us'));
  assert.equal(new URL(usa.headers.get('x-middleware-rewrite')).pathname, '/en-US/about');
  assert.equal(usa.headers.get('x-next-locale'), 'en-US');

  const bare = await mw(mockRequest('/about-us'));
  assert.equal(new URL(bare.headers.get('location')).pathname, '/en/about-us');

  const link = (await mw(mockRequest('/rus/o-nas'))).headers.get('link');
  assert.ok(link.includes('<http://localhost:3000/usa/about-us>; rel="alternate"; hreflang="en-US"'), link);
  assert.ok(link.includes('<http://localhost:3000/rus/o-nas>; rel="alternate"; hreflang="ru"'), link);
});

test('middleware as-needed strips a custom default-locale prefix', async () => {
  const mw = createI18nMiddleware({
    locales,
    defaultLocale: 'en',
    localePrefix: { mode: 'as-needed', prefixes: { en: '/english', ru: '/rus' } },
  });

  const stripped = await mw(mockRequest('/english/docs'));
  assert.equal(new URL(stripped.headers.get('location')).pathname, '/docs');
  assert.equal(stripped.headers.get('x-next-locale'), 'en');

  // Even without localized slugs, a custom public prefix must rewrite to the locale code.
  const russian = await mw(mockRequest('/rus/docs'));
  assert.equal(russian.headers.get('x-next-locale'), 'ru');
  assert.equal(russian.headers.get('x-middleware-rewrite'), 'http://localhost:3000/ru/docs');
  assert.equal(russian.headers.get('location'), null);
});
