import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createNavigation } from '../dist/navigation.js';
import { FluentProvider } from '../dist/client.js';
import { createFluentBundle, createTranslator, getBundleCacheStats } from '../dist/bundle.js';
import { pseudoLocalizeFtl } from '../dist/pseudo.js';
import { generateTypeDeclarations } from '../dist/typegen.js';
import { createI18nMiddleware } from '../dist/middleware.js';

// ---------------------------------------------------------------------------
// N01: locale switching must never produce doubled locale prefixes
// ---------------------------------------------------------------------------

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
};

function renderLink(nav, props, providerLocale = 'en') {
  const element = React.createElement(nav.Link, props, 'L');
  const wrapped = React.createElement(
    FluentProvider,
    { locale: providerLocale, messages: 'x = X' },
    element
  );
  const html = renderToStaticMarkup(wrapped);
  const match = /href="([^"]*)"/.exec(html);
  return match ? match[1] : null;
}

test('N01: Link with locale prop renders correct hrefs in "as-needed" mode', () => {
  const nav = createNavigation(routing);

  // Switch to a NON-default locale: canonical href already carries the prefix.
  assert.equal(renderLink(nav, { href: '/about', locale: 'ru' }), '/ru/o-nas');
  assert.equal(renderLink(nav, { href: '/ru/o-nas', locale: 'ru' }), '/ru/o-nas');

  // Switch to the default locale uses the temporary signal URL (canonicalized
  // by middleware, which also persists the locale cookie).
  assert.equal(renderLink(nav, { href: '/about', locale: 'en' }), '/en/about-us');
  assert.equal(renderLink(nav, { href: '/ru/o-nas', locale: 'en' }), '/en/about-us');

  // No explicit locale: current provider locale is used, no signal needed.
  assert.equal(renderLink(nav, { href: '/about' }, 'en'), '/about-us');
  assert.equal(renderLink(nav, { href: '/about' }, 'ru'), '/ru/o-nas');
});

test('N01: Link hrefs are correct in "never" and "always" modes', () => {
  const never = createNavigation({ ...routing, localePrefix: 'never', pathnames: routing.pathnames });
  assert.equal(renderLink(never, { href: '/about', locale: 'ru' }), '/ru/o-nas');
  assert.equal(renderLink(never, { href: '/about', locale: 'en' }), '/en/about-us');
  assert.equal(renderLink(never, { href: '/about' }, 'ru'), '/o-nas');

  const always = createNavigation({ ...routing, localePrefix: 'always', pathnames: routing.pathnames });
  assert.equal(renderLink(always, { href: '/about', locale: 'ru' }), '/ru/o-nas');
  assert.equal(renderLink(always, { href: '/about', locale: 'en' }), '/en/about-us');
  assert.equal(renderLink(always, { href: '/about' }, 'ru'), '/ru/o-nas');
});

// ---------------------------------------------------------------------------
// N02/N03: raw()
// ---------------------------------------------------------------------------

test('N02: t.raw keeps working for messages with variables (placeholders + args)', () => {
  const bundle = createFluentBundle('en', 'hello = Hello { $name }!');
  const t = createTranslator(bundle);
  assert.equal(t.raw('hello'), 'Hello {$name}!');
  assert.equal(t.raw('hello', { name: 'Ada' }), 'Hello Ada!');
});

test('N03: t.raw returns the message value when attributes are present too', () => {
  const bundle = createFluentBundle(
    'en',
    'msg = The Value\n    .attr = The Attr\n    .other = Other'
  );
  const t = createTranslator(bundle);
  assert.equal(t.raw('msg'), 'The Value');
  assert.equal(t.raw('msg.attr'), 'The Attr');
  assert.deepEqual(t.raw('msg.other'), 'Other');
});

test('N03: t.raw still returns an array for attribute-only messages', () => {
  const bundle = createFluentBundle('en', 'only =\n    .b = Second\n    .a = First');
  const t = createTranslator(bundle);
  assert.deepEqual(t.raw('only'), ['First', 'Second']);
});

// ---------------------------------------------------------------------------
// N04: React element tokens must not leak into plain t() strings
// ---------------------------------------------------------------------------

test('N04: plain t() throws a clear error instead of leaking React tokens', () => {
  const bundle = createFluentBundle('en', 'greet = Hello { $user }!\nplain = Just text');
  const t = createTranslator(bundle, {
    defaultTranslationValues: { user: React.createElement('b', null, 'Bob'), unused: React.createElement('i') },
  });

  // Referencing an element from plain t() is a developer error.
  assert.throws(() => t('greet'), /interpolates a React element[\s\S]*t\.rich/);

  // Unused element defaults must not affect plain messages.
  assert.equal(t('plain'), 'Just text');

  // t.rich keeps working with elements.
  const rich = t.rich('greet');
  assert.ok(React.isValidElement(rich));
  const html = renderToStaticMarkup(rich);
  assert.ok(html.includes('<b>Bob</b>'));
});

test('N04: elements passed as call arguments also produce the clear error', () => {
  const bundle = createFluentBundle('en', 'greet = Hello { $user }!');
  const t = createTranslator(bundle);
  assert.throws(
    () => t('greet', { user: React.createElement('b', null, 'Bob') }),
    /interpolates a React element/
  );
});

// ---------------------------------------------------------------------------
// N05: entry points share a single runtime (caches, config globals)
// ---------------------------------------------------------------------------

test('N05: config and caches are shared across dist entry points', async () => {
  const server = await import('../dist/server.js');
  const factory = await import('../dist/factory.js');
  const bundleMod = await import('../dist/bundle.js');

  server.setRequestConfig(() => ({ messages: 'shared = FROM_GLOBAL_CONFIG' }));

  // The factory entry (its own module instance before the fix) must see the
  // global config registered through the server entry.
  const runtime = factory.createI18n({ locales: ['en'], defaultLocale: 'en' });
  const t = await runtime.getTranslations();
  assert.equal(t('shared'), 'FROM_GLOBAL_CONFIG');

  // Bundle-cache bookkeeping is global: server-side bundle creation is visible
  // through the public cache stats API.
  const before = bundleMod.getBundleCacheStats();
  await server.forLocale('en', { messages: 'counter = C' });
  const after = bundleMod.getBundleCacheStats();
  assert.ok(
    after.resourceCount > before.resourceCount || after.bundleCount > before.bundleCount,
    `expected shared cache growth, got ${JSON.stringify({ before, after })}`
  );

  bundleMod.clearBundleCache();
  const cleared = bundleMod.getBundleCacheStats();
  assert.equal(cleared.resourceCount, 0);
  assert.equal(cleared.bundleCount, 0);
});

// ---------------------------------------------------------------------------
// N13: pseudo-localization brackets wrap whole messages
// ---------------------------------------------------------------------------

test('N13: pseudoLocalizeFtl brackets the whole message instead of each text run', () => {
  const pseudo = pseudoLocalizeFtl('greet = Hello { $name }, welcome\nsolo = Only text');
  const greetLine = pseudo.split('\n').find((line) => line.startsWith('greet'));
  assert.ok(greetLine, 'greet message missing from pseudo output');

  // Exactly one bracket pair per single-pattern message, at the true edges.
  assert.equal((greetLine.match(/\[/g) ?? []).length, 1);
  assert.equal((greetLine.match(/\]/g) ?? []).length, 1);
  assert.ok(greetLine.includes('{ $name }'));
  assert.ok(!greetLine.includes(']{'), `scattered brackets found in: ${greetLine}`);

  const soloLine = pseudo.split('\n').find((line) => line.startsWith('solo'));
  assert.ok(soloLine.startsWith('solo = [') && soloLine.endsWith(']'));
});

// ---------------------------------------------------------------------------
// N14: middleware Host-header hardening via trustedHosts
// ---------------------------------------------------------------------------

function mockRequest(path, hostHeaders = {}) {
  return {
    url: `https://site.com${path}`,
    nextUrl: { pathname: path.split('?')[0], search: '' },
    cookies: { get: () => undefined },
    headers: {
      get: (name) => hostHeaders[name] ?? null,
    },
  };
}

test('N14: trustedHosts rejects foreign Host values with 421 before any redirect', async () => {
  const mw = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
    trustedHosts: ['site.com', '*.site.com'],
  });

  // Spoofed Host + x-forwarded-host must not receive a redirect at all.
  const res = await mw(mockRequest('/about', { host: 'evil.com', 'x-forwarded-host': 'evil.com' }));
  assert.equal(res.status, 421);
  assert.equal(res.headers.get('location'), null);

  // Trusted hosts keep working, with absolute Location built from the request.
  const ok = await mw(mockRequest('/about', { host: 'site.com' }));
  assert.equal(ok.status, 307);
  assert.equal(ok.headers.get('location'), 'https://site.com/en/about');

  // Subdomain wildcard.
  const sub = await mw(mockRequest('/about', { host: 'cdn.site.com' }));
  assert.equal(sub.status, 307);
});

// ---------------------------------------------------------------------------
// N13 (typegen): attribute-only messages must not expose a value key
// ---------------------------------------------------------------------------

test('typegen omits the bare id key for attribute-only messages', () => {
  const d = String.fromCharCode(36);
  const output = generateTypeDeclarations(`only-attrs =\n    .title = Just a title\nvalue-msg = Has { ${d}name }`);
  assert.ok(!output.includes("'only-attrs':"), 'attribute-only id must not be a value key');
  assert.ok(output.includes("'only-attrs.title'"));
  assert.ok(output.includes("'value-msg':"));
});
