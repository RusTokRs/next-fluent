/**
 * Audit pass 25 — see ENGINEERING_AUDIT_V25.md.
 *
 * `factory.js` and `navigation.js` both reported 100% of their lines with roughly
 * 72% of their branches, which the text reporter cannot explain: an uncovered
 * arm of `a ?? b` sits on a line that runs. The ranges below came from V8's own
 * coverage data (`NODE_V8_COVERAGE`), not from reading the source and guessing.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import test from 'node:test';

import { createNavigation } from '../dist/navigation.js';
import { FluentProvider } from '../dist/client.js';
import { createI18n } from '../dist/factory.js';
import * as server from '../dist/server.js';

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: false,
};

// ---------------------------------------------------------------------------
// navigation.js — `usePathname` arms that no test had taken
// ---------------------------------------------------------------------------

function renderPathname(config, nextPathname, locale = 'ru') {
  const nav = createNavigation(config);
  function Probe() {
    return React.createElement('span', null, String(nav.usePathname()));
  }
  return renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale, messages: 'x = X' },
      React.createElement(
        PathnameContext.Provider,
        { value: nextPathname },
        React.createElement(Probe)
      )
    )
  ).replace(/<\/?span>/g, '');
}

test('V25-01: an empty Next pathname is returned as-is, not resolved', () => {
  // `usePathname()` is falsy outside an App Router request; the hook hands back
  // the empty value instead of inventing a path.
  assert.equal(renderPathname(routing, ''), '');
});

test('V25-02: the root path short-circuits before the internal lookup', () => {
  assert.equal(renderPathname(routing, '/'), '/');
  assert.equal(renderPathname(routing, '/ru'), '/');
});

test('V25-03: a path that is exactly the basePath becomes the root', () => {
  const withBase = { ...routing, basePath: '/app' };
  // `rawPathname.slice(basePath.length)` is the empty string here, and the
  // `|| '/'` is what keeps the result a usable pathname.
  assert.equal(renderPathname(withBase, '/app'), '/');
  assert.equal(renderPathname(withBase, '/app/ru/about'), '/about');
});

test('V25-04: a pathname with no locale prefix is passed through unmapped', () => {
  // Neither the domain prefix table nor the default one matches, so `prefixMatch`
  // is null and the raw pathname is what gets looked up.
  const noPrefix = { ...routing, localePrefix: 'never' };
  assert.equal(renderPathname(noPrefix, '/about'), '/about');
});

// ---------------------------------------------------------------------------
// navigation.js — the locale fallback chain and the scroll option
// ---------------------------------------------------------------------------

function renderRouter(config, locale, calls) {
  const nav = createNavigation(config);
  let router;
  function Probe() {
    router = nav.useRouter();
    return null;
  }
  const nextRouter = Object.fromEntries(
    ['push', 'replace', 'prefetch', 'back', 'forward', 'refresh'].map((name) => [
      name,
      (...args) => calls.push([name, ...args]),
    ])
  );
  renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale, messages: 'x = X' },
      React.createElement(AppRouterContext.Provider, { value: nextRouter }, React.createElement(Probe))
    )
  );
  return router;
}

test('V25-05: push and replace without options use the provider locale', () => {
  const calls = [];
  const router = renderRouter(routing, 'ru', calls);

  router.push('/about');
  router.replace('/about');

  assert.equal(calls.length, 2);
  // The provider locale decides the target when no explicit one is given.
  assert.match(calls[0][1], /\/ru\//, `expected a Russian target, got ${calls[0][1]}`);
  assert.match(calls[1][1], /\/ru\//);
});

test('V25-06: the scroll option is forwarded, and only when given', () => {
  const calls = [];
  const router = renderRouter(routing, 'en', calls);

  router.push('/about');
  router.push('/about', { scroll: false });
  router.replace('/about', { scroll: true });

  assert.equal(calls[0][2], undefined, 'no options means no router options object at all');
  assert.deepEqual(calls[1][2], { scroll: false });
  assert.deepEqual(calls[2][2], { scroll: true });
});

test('V25-07: prefetch without options uses the provider locale', () => {
  const calls = [];
  const router = renderRouter(routing, 'ru', calls);

  router.prefetch('/about');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'prefetch');
  assert.match(calls[0][1], /\/ru\//);
});

// ---------------------------------------------------------------------------
// factory.js — the call shapes `createI18n` accepts
// ---------------------------------------------------------------------------

const CATALOGS = { en: 'greeting = Hello\n', ru: 'greeting = Привет\n' };

function makeRuntime() {
  return createI18n({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
    loadMessages: (locale) => CATALOGS[locale] ?? CATALOGS.en,
  });
}

test('V25-08: getStaticParams lists every locale', () => {
  assert.deepEqual(makeRuntime().getStaticParams(), [{ locale: 'en' }, { locale: 'ru' }]);
});

test('V25-09: forLocale accepts a namespace string and an options object alike', async () => {
  const runtime = makeRuntime();

  const fromString = await runtime.forLocale('ru', 'unused-namespace');
  assert.equal(typeof fromString, 'function');

  const fromObject = await runtime.forLocale('ru', { debug: false });
  assert.equal(fromObject('greeting'), 'Привет');
});

test('V25-10: getTranslations accepts a string, an object with a locale, and neither', async () => {
  const runtime = makeRuntime();

  // An explicit locale in the options object.
  const ru = await runtime.getTranslations({ locale: 'ru' });
  assert.equal(ru('greeting'), 'Привет');

  // A bare string is the namespace form; the locale comes from the request,
  // which outside one falls back to the configured default.
  const byString = await runtime.getTranslations('some-namespace');
  assert.equal(typeof byString, 'function');

  // No argument at all.
  const bare = await runtime.getTranslations();
  assert.equal(bare('greeting'), 'Hello', 'with no locale given the default locale is used');
});

test('V25-11: getFormatter respects an explicit locale and timeZone', async () => {
  const runtime = makeRuntime();

  const explicit = await runtime.getFormatter({ locale: 'ru', timeZone: 'UTC' });
  assert.equal(typeof explicit.number, 'function');

  const bare = await runtime.getFormatter();
  assert.equal(typeof bare.number, 'function');

  // The formatter really is locale-aware, not a passthrough.
  assert.notEqual(
    explicit.number(1234.5),
    (await makeRuntime().getFormatter({ locale: 'en', timeZone: 'UTC' })).number(1234.5)
  );
});

test('V25-12: getMessages uses the runtime loader for the requested locale', async () => {
  const runtime = makeRuntime();
  assert.equal(await runtime.getMessages('ru'), CATALOGS.ru);
  assert.equal(await runtime.getMessages('en'), CATALOGS.en);
});

test('V25-13: getLocale falls back to the configured default outside a request', async () => {
  // There is no request scope here, so the header, the cookie and
  // `Accept-Language` all come up empty and the default locale is the answer.
  assert.equal(await makeRuntime().getLocale(), 'en');
});

test('V25-14: a runtime without loadMessages falls back to the global request config', async () => {
  const bare = createI18n({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' });

  // With neither a loader nor a global config there is nothing to serve, so the
  // catalog is empty and every message degrades to its key. That is the
  // documented fallback (`defaultMessageFallback` renders the key), not an
  // error — pinned here so the shape of it cannot drift unnoticed.
  assert.equal(await bare.getMessages('en'), '');
  assert.equal((await bare.forLocale('en'))('greeting'), 'greeting');

  server.setRequestConfig(async ({ locale }) => ({ locale, messages: 'greeting = Global\n' }));
  try {
    assert.equal(await bare.getMessages('en'), 'greeting = Global\n');
  } finally {
    // Leave no global config behind for the tests that follow in this file.
    server.setRequestConfig(undefined);
  }
});
