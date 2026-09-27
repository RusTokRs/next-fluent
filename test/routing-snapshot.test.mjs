import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRouting } from '../dist/routing.js';
import { createNavigation } from '../dist/navigation.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { createI18n } from '../dist/factory.js';

function sourceConfig() {
  return {
    locales: ['en', 'ru'], defaultLocale: 'en',
    localePrefix: { mode: 'always', prefixes: { en: '/english', ru: '/rus' } },
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' }, '/shared': '/shared' },
    domains: [{ domain: 'example.test', defaultLocale: 'en', locales: ['en', 'ru'],
      localePrefix: { mode: 'as-needed', prefixes: { en: '/eng', ru: '/russian' } } }],
    localeCookie: { name: 'LANG', path: '/app', sameSite: 'lax', maxAge: 60 },
    trustedHosts: ['example.test'], basePath: '/app', localeDetection: false,
  };
}
function request(path, host = 'example.test') {
  const url = new URL(path, 'https://backend.internal:3000');
  return { url: url.href, nextUrl: { pathname: url.pathname, search: url.search },
    headers: new Headers({ host }), cookies: { get: () => undefined } };
}
function assertSnapshot(source, snapshot) {
  if (source === null || typeof source !== 'object') {
    assert.equal(snapshot, source);
    return;
  }
  assert.notEqual(snapshot, source, 'caller-owned object must be copied');
  assert.ok(Object.isFrozen(snapshot), 'every copied container must be frozen');
  assert.equal(Object.isFrozen(source), false, 'caller-owned objects must stay mutable');
  for (const key of Object.keys(source)) assertSnapshot(source[key], snapshot[key]);
}

test('defineRouting copies and freezes every supported nested setting without freezing its input', () => {
  const source = sourceConfig();
  const routing = defineRouting(source);
  assertSnapshot(source, routing);
  assert.equal(routing.cookieName, 'NEXT_LOCALE');
  assert.equal(routing.headerName, 'x-next-locale');
});

test('mutating global prefixes, pathnames and locales cannot desynchronize navigation and middleware', async () => {
  const source = sourceConfig();
  delete source.domains;
  const routing = defineRouting(source);
  const navigation = createNavigation(routing);
  const middleware = createI18nMiddleware(routing);
  const expected = '/app/rus/o-nas?q=1';
  assert.equal(navigation.getPathname({ href: '/about?q=1', locale: 'ru' }), expected);

  source.localePrefix.prefixes.ru = '/russian';
  source.localePrefix.mode = 'never';
  source.pathnames['/about'].ru = '/changed';
  source.pathnames['/shared'] = '/changed-shared';
  source.pathnames['/extra'] = '/extra';
  source.locales.push('de');
  source.defaultLocale = 'ru';
  source.basePath = '/changed-app';
  delete source.pathnames['/about'];

  for (const nav of [navigation, createNavigation(routing)]) {
    assert.equal(nav.getPathname({ href: '/about?q=1', locale: 'ru' }), expected);
    assert.equal(nav.getPathname({ href: '/shared', locale: 'en' }), '/app/english/shared');
  }
  const response = await middleware(request(expected));
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-next-locale'), 'ru');
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://backend.internal:3000/app/ru/about?q=1');
  assert.match(response.headers.get('link'), /https:\/\/example.test\/app\/rus\/o-nas\?q=1/);
  assert.deepEqual(routing.locales, ['en', 'ru']);
  assert.equal(routing.defaultLocale, 'en');
});

test('domain overrides, locale cookies and trusted hosts are isolated from subsequent input mutations', async () => {
  const source = sourceConfig();
  const routing = defineRouting(source);
  const navigation = createNavigation(routing);
  const middleware = createI18nMiddleware(routing);
  source.domains[0].localePrefix.prefixes.ru = '/changed';
  source.domains[0].localePrefix.mode = 'never';
  source.domains[0].locales.splice(1);
  source.domains[0].domain = 'evil.test';
  source.domains[0].defaultLocale = 'ru';
  source.domains.push({ domain: 'another.test', defaultLocale: 'ru' });
  source.localeCookie.name = 'CHANGED';
  source.localeCookie.path = '/changed';
  source.trustedHosts.push('evil.test');
  source.trustedHosts[0] = 'other.test';

  assert.equal(navigation.getPathname({ href: '/about', locale: 'ru' }), 'https://example.test/app/russian/o-nas');
  const response = await middleware(request('/app/russian/o-nas'));
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://backend.internal:3000/app/ru/about');
  assert.match(response.headers.get('set-cookie'), /LANG=ru/);
  assert.match(response.headers.get('set-cookie'), /Path=\/app/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /CHANGED|\/changed/);
  assert.equal((await middleware(request('/app/russian/o-nas', 'evil.test'))).status, 421);
});

test('direct writes into returned settings fail, including additions, removals and array operations', () => {
  const routing = defineRouting(sourceConfig());
  const writes = [
    () => { routing.defaultLocale = 'ru'; },
    () => { routing.locales.push('de'); },
    () => { routing.localePrefix.mode = 'never'; },
    () => { routing.localePrefix.prefixes.ru = '/changed'; },
    () => { routing.localePrefix.prefixes.de = '/de'; },
    () => { delete routing.localePrefix.prefixes.ru; },
    () => { routing.pathnames['/about'].ru = '/changed'; },
    () => { routing.pathnames['/extra'] = '/extra'; },
    () => { routing.domains.push({ domain: 'other.test', defaultLocale: 'en' }); },
    () => { routing.domains[0].domain = 'other.test'; },
    () => { routing.domains[0].locales.pop(); },
    () => { routing.domains[0].localePrefix.prefixes.ru = '/changed'; },
    () => { routing.localeCookie.name = 'CHANGED'; },
    () => { routing.trustedHosts[0] = 'other.test'; },
  ];
  for (const write of writes) assert.throws(write, TypeError);
});

test('snapshots from the same mutable input are independent and accepted by all consumers', async () => {
  const source = sourceConfig();
  const first = defineRouting(source);
  source.domains[0].localePrefix.prefixes.ru = '/second';
  const second = defineRouting(source);
  const again = defineRouting(first); // Already frozen input must remain reusable.
  assert.equal(createNavigation(first).getPathname({ href: '/about', locale: 'ru' }), 'https://example.test/app/russian/o-nas');
  assert.equal(createNavigation(second).getPathname({ href: '/about', locale: 'ru' }), 'https://example.test/app/second/o-nas');
  assert.deepEqual(again, first);
  assert.notEqual(again.domains, first.domains);
  const runtime = createI18n(first);
  assert.equal(runtime.navigation.getPathname({ href: '/about', locale: 'ru' }), 'https://example.test/app/russian/o-nas');
  assert.equal((await runtime.middleware(request('/app/russian/o-nas'))).headers.get('x-next-locale'), 'ru');
});

test('false and omitted options retain their values and default normalization', () => {
  const source = { locales: ['en'], defaultLocale: 'en', localeCookie: false, alternateLinks: false };
  const routing = defineRouting(source);
  assert.deepEqual(routing, { ...source, localePrefix: 'always', cookieName: 'NEXT_LOCALE', headerName: 'x-next-locale' });
  assertSnapshot(source, routing);
  assert.equal(Object.hasOwn(routing, 'domains'), false);
  assert.equal(Object.hasOwn(routing, 'pathnames'), false);
});

test('invalid configs are still rejected without freezing any caller-owned containers', () => {
  const source = sourceConfig();
  source.domains[0].localePrefix.prefixes.ru = '/eng';
  assert.throws(() => defineRouting(source), /Duplicate locale prefix/);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.domains), false);
  assert.equal(Object.isFrozen(source.domains[0].localePrefix.prefixes), false);
  source.domains[0].localePrefix.prefixes.ru = '/russian';
  assert.doesNotThrow(() => defineRouting(source));
  source.localePrefix = null;
  assert.throws(() => defineRouting(source), 'invalid null must not become the default prefix mode');
  assert.equal(Object.isFrozen(source), false);
});

test('the exact copied values are validated and accessors are read only once', () => {
  const source = sourceConfig();
  delete source.domains;
  let configReads = 0;
  let prefixReads = 0;
  const prefixes = Object.defineProperty({}, 'ru', {
    enumerable: true,
    get() { prefixReads++; return prefixReads === 1 ? '/russian' : '/en'; },
  });
  Object.defineProperty(source, 'localePrefix', {
    enumerable: true,
    get() { configReads++; return { mode: 'always', prefixes }; },
  });
  const routing = defineRouting(source);
  assert.equal(createNavigation(routing).getPathname({ href: '/about', locale: 'ru' }), '/app/russian/o-nas');
  assert.equal(configReads, 1);
  assert.equal(prefixReads, 1);
  assert.equal(Object.getOwnPropertyDescriptor(routing.localePrefix.prefixes, 'ru').get, undefined);
});

test('null-prototype maps and shared input containers are snapshotted safely', () => {
  const source = sourceConfig();
  source.localePrefix.prefixes = Object.assign(Object.create(null), source.localePrefix.prefixes);
  source.pathnames = Object.assign(Object.create(null), source.pathnames);
  source.domains[0].locales = source.locales;
  const routing = defineRouting(source);
  assertSnapshot(source, routing);
  assert.equal(routing.locales, routing.domains[0].locales, 'shared data can share one immutable copy');
  source.locales.push('de');
  source.localePrefix.prefixes.ru = '/changed';
  assert.deepEqual(routing.domains[0].locales, ['en', 'ru']);
  assert.equal(routing.localePrefix.prefixes.ru, '/rus');
});

test('extension metadata is not corrupted and caller-owned opaque values are not frozen', () => {
  const symbol = Symbol('application metadata');
  const source = sourceConfig();
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const callback = () => 'metadata';
  const metadata = { timestamp, callback };
  metadata.self = metadata;
  source[symbol] = metadata;
  const routing = defineRouting(source);
  assert.notEqual(routing[symbol], metadata);
  assert.equal(routing[symbol].self, routing[symbol]);
  assert.ok(Object.isFrozen(routing[symbol]));
  assert.equal(routing[symbol].timestamp, timestamp);
  assert.equal(routing[symbol].callback, callback);
  assert.equal(Object.isFrozen(timestamp), false);
  assert.equal(Object.isFrozen(callback), false);
  assert.equal(Object.isFrozen(metadata), false);
});
