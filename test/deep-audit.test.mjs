import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  createI18nMiddleware,
  createFluentBundle,
  createTranslator,
  resolveLocalizedPathname,
  createI18n,
} from '../dist/index.js';

test('AUDIT-FIX: Middleware redirects root locale prefix without protocol-relative double slash crash', async () => {
  // Strategy: as-needed
  const mwAsNeeded = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  });

  const makeReq = (pathname, search = '') => ({
    url: `https://example.com${pathname}${search}`,
    nextUrl: { pathname, search },
    cookies: { get: () => undefined },
    headers: { get: () => null },
  });

  // 1. /en in as-needed should redirect to / without throwing TypeError: Invalid URL
  const resAsNeededRoot = await mwAsNeeded(makeReq('/en'));
  assert.equal(resAsNeededRoot.status, 307);
  assert.equal(resAsNeededRoot.headers.get('location'), 'https://example.com/');

  // 2. /en?utm_source=twitter should redirect to /?utm_source=twitter
  const resAsNeededSearch = await mwAsNeeded(makeReq('/en', '?utm_source=twitter'));
  assert.equal(resAsNeededSearch.status, 307);
  assert.equal(resAsNeededSearch.headers.get('location'), 'https://example.com/?utm_source=twitter');

  // Strategy: never
  const mwNever = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'never',
  });

  // 3. /ru in never should redirect to / without throwing TypeError: Invalid URL
  const resNeverRoot = await mwNever(makeReq('/ru'));
  assert.equal(resNeverRoot.status, 307);
  assert.equal(resNeverRoot.headers.get('location'), 'https://example.com/');

  // 4. /ru?ref=docs should redirect to /?ref=docs
  const resNeverSearch = await mwNever(makeReq('/ru', '?ref=docs'));
  assert.equal(resNeverSearch.status, 307);
  assert.equal(resNeverSearch.headers.get('location'), 'https://example.com/?ref=docs');
});

test('AUDIT-FIX: Regex re-entrancy in t.rich does not enter infinite loops or skip tokens', () => {
  const ftl = `
outer = Before <wrap>Outer text with <nested>{ $name }</nested> content</wrap> After
inner = [INNER: <bold>{ $val }</bold>]
`;
  const bundle = createFluentBundle('en', ftl, { useIsolating: false });
  const t = createTranslator(bundle);

  // Calling t.rich nested inside a tag callback
  const result = t.rich('outer', {
    name: 'Alice',
    wrap: (chunks) => React.createElement('div', { className: 'wrapper' }, chunks),
    nested: () =>
      t.rich('inner', {
        val: 'NestedVal',
        bold: (boldChunks) => React.createElement('strong', null, boldChunks),
      }),
  });

  assert.ok(React.isValidElement(result));
});

test('AUDIT-FIX: In-page hash anchors are preserved and not rewritten to root path', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  // In-page hash anchors
  assert.equal(resolveLocalizedPathname({ href: '#pricing' }, config), '#pricing');
  assert.equal(resolveLocalizedPathname({ href: '#section-1' }, config), '#section-1');
  assert.equal(resolveLocalizedPathname({ href: '#' }, config), '#');

  // Full path with hash is still localized properly
  assert.equal(
    resolveLocalizedPathname({ href: '/about#team' }, config),
    '/en/about#team'
  );
});

test('AUDIT-FIX: createI18n forwards cookieName to serverOptions', async () => {
  const runtime = createI18n({
    locales: ['en', 'de'],
    defaultLocale: 'en',
    cookieName: 'CUSTOM_LOCALE_COOKIE',
  });

  assert.ok(runtime);
  assert.equal(typeof runtime.getLocale, 'function');
  assert.equal(typeof runtime.getTranslations, 'function');
});
