import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineRouting } from '../dist/routing.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { normalizeLeadingSlashes } from '../dist/locale-prefix.js';
import { resolveAcceptLanguage, matchSupportedLocale } from '../dist/utils.js';
import { jsonToFluent } from '../dist/catalog.js';
import { createFluentBundle } from '../dist/bundle.js';
import { checkCatalogs } from '../dist/check.js';
import { readCatalogsByLocale, watchCatalogs } from '../dist/catalog-io.js';
import { pickMessages } from '../dist/pick-messages.js';

/** Minimal `NextRequest`-shaped stub: only what the middleware reads. */
function mockRequest(pathname, headers = {}, cookie) {
  const url = new URL(pathname, 'http://localhost:3000');
  const all = { host: 'localhost:3000', ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: {
      get: (name) => (name === 'NEXT_LOCALE' && cookie !== undefined ? { value: cookie } : undefined),
    },
    headers: {
      get: (name) => all[name.toLowerCase()] ?? null,
      forEach: (cb) => {
        for (const [key, value] of Object.entries(all)) cb(value, key);
      },
    },
  };
}

const ORIGIN = 'http://localhost:3000';

/** Every prefix mode, including a custom default-locale prefix. */
const ROUTINGS = [
  { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' },
  { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never' },
  { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed' },
  {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: { mode: 'as-needed', prefixes: { en: '/english' } },
  },
];

test('open redirect: protocol-relative paths never leave the origin', async () => {
  // `//evil.example/x` and `\evil.example/x` resolve to another origin when they
  // reach `new URL(path, origin)` unmodified.
  const hostile = [
    '/ru//evil.example/x',
    '/ru/\\evil.example/x',
    '/ru///evil.example/x',
    '/en//evil.example/x',
    '/english//evil.example/x',
    '/ru/%2f%2fevil.example',
  ];

  for (const routing of ROUTINGS) {
    const middleware = createI18nMiddleware(defineRouting(routing));
    for (const pathname of hostile) {
      const response = await middleware(mockRequest(pathname));
      const target =
        response.headers.get('location') ?? response.headers.get('x-middleware-rewrite');
      if (!target) continue;
      assert.equal(
        new URL(target).origin,
        ORIGIN,
        `${JSON.stringify(routing.localePrefix)} + ${pathname} escaped the origin: ${target}`
      );
    }
  }
});

test('normalizeLeadingSlashes collapses a run of slashes and backslashes', () => {
  assert.equal(normalizeLeadingSlashes('//evil.example/x'), '/evil.example/x');
  assert.equal(normalizeLeadingSlashes('/\\evil.example/x'), '/evil.example/x');
  assert.equal(normalizeLeadingSlashes(String.raw`\\host`), '/host');
  assert.equal(normalizeLeadingSlashes('///'), '/');
  // Interior and ordinary paths are untouched.
  assert.equal(normalizeLeadingSlashes('/a//b'), '/a//b');
  assert.equal(normalizeLeadingSlashes('/about'), '/about');
});

test('open redirect: an untrusted Host cannot be reflected into a redirect', async () => {
  const middleware = createI18nMiddleware(
    defineRouting({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never' })
  );
  // `/ru/about` must lose its prefix in `never` mode, i.e. it always redirects.
  const response = await middleware(
    mockRequest('/ru/about', { 'x-forwarded-host': 'evil.example' })
  );
  const location = response.headers.get('location');
  assert.ok(location, 'expected a redirect');
  assert.equal(new URL(location).origin, ORIGIN);
});

test('trustedHosts: a foreign Host is refused with 421', async () => {
  const middleware = createI18nMiddleware(
    defineRouting({
      locales: ['en', 'ru'],
      defaultLocale: 'en',
      trustedHosts: ['example.com'],
    })
  );
  const response = await middleware(mockRequest('/', { host: 'evil.example' }));
  assert.equal(response.status, 421);
});

test('cookie injection: hostile NEXT_LOCALE values fall back to a valid locale', async () => {
  const middleware = createI18nMiddleware(
    defineRouting({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' })
  );
  // `/about` carries no prefix, so `always` mode must redirect — to a locale
  // taken from the cookie, or to the default when the cookie is not a locale.
  for (const cookie of ['ru\r\nSet-Cookie: x=1', 'ru; Path=/hack', '../../../etc', 'RU']) {
    const response = await middleware(mockRequest('/about', {}, cookie));
    const location = response.headers.get('location');
    assert.ok(location, `no redirect for ${JSON.stringify(cookie)}`);
    const { origin, pathname } = new URL(location);
    assert.equal(origin, ORIGIN);
    assert.match(pathname, /^\/(en|ru)\//, `bad locale for ${JSON.stringify(cookie)}`);
  }
});

test('locale resolution refuses values that are not supported locales', () => {
  for (const locale of ['en\r\nX: 1', '../../', '', 'en-US-x'.repeat(40)]) {
    assert.equal(matchSupportedLocale(locale, ['en', 'ru']), undefined, JSON.stringify(locale));
  }
  assert.equal(matchSupportedLocale('ru', ['en', 'ru']), 'ru');
  assert.equal(matchSupportedLocale('RU', ['en', 'ru']), 'ru');
});

test('Accept-Language: garbage never matches, and long headers stay fast', () => {
  assert.equal(resolveAcceptLanguage(';;;;', ['en', 'ru']), undefined);
  assert.equal(resolveAcceptLanguage('', ['en', 'ru']), undefined);
  const started = Date.now();
  assert.equal(resolveAcceptLanguage('en;q=0.1,'.repeat(20000), ['en', 'ru']), 'en');
  assert.ok(Date.now() - started < 5000, 'Accept-Language parsing was too slow');
});

test('routing: prefixes with traversal segments are rejected', () => {
  for (const prefixes of [{ ru: '/../evil' }, { ru: '/..' }, { ru: '/a/../b' }, { ru: '/./en' }]) {
    assert.throws(
      () => defineRouting({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: { mode: 'always', prefixes } }),
      /localePrefix/,
      `expected ${JSON.stringify(prefixes)} to be rejected`
    );
  }
  const routing = defineRouting({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: { mode: 'as-needed', prefixes: { en: '/english' } },
  });
  assert.equal(routing.localePrefix.prefixes.en, '/english');
});

test('JSON catalogs: values cannot inject messages, and CR cannot destroy them', () => {
  // A carriage return used to end the string literal, which made the runtime
  // parser drop the whole message silently.
  const source = jsonToFluent({
    a: 'value\nEVIL-MESSAGE = pwned',
    b: 'value\n    .evil = pwned',
    c: 'value\n# comment',
    d: 'value\n-term = ignored',
    e: 'value\r\nEVIL2 = pwned',
  });
  const bundle = createFluentBundle('en', source);
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    assert.ok(bundle.hasMessage(id), `expected message ${id} to survive`);
  }
  for (const injected of ['EVIL-MESSAGE', 'EVIL2', 'term']) {
    assert.equal(bundle.hasMessage(injected), false, `${injected} was injected`);
  }
  const attributes = bundle.getMessage('a')?.attributes;
  const attributeCount = Array.isArray(attributes)
    ? attributes.length
    : Object.keys(attributes ?? {}).length;
  assert.equal(attributeCount, 0, 'attribute was injected');
});

test('JSON catalogs: `__proto__` keys are refused, not assigned', () => {
  const before = Object.prototype.polluted;
  assert.throws(() => jsonToFluent(JSON.parse('{"__proto__":{"a":"1"}}')));
  assert.equal(Object.prototype.polluted, before);
});

test('pickMessages keeps only the namespace and leaves Object.prototype alone', () => {
  assert.equal(pickMessages('a = 1\nb = 2\n', 'a'), 'a = 1\n');
  assert.equal(Object.prototype.hasOwnProperty.call({}, 'a'), false);
});

test('check: a catalog named __proto__.ftl is reported, not silently dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-proto-'));
  try {
    fs.writeFileSync(path.join(dir, '__proto__.ftl'), 'a = 1\n');
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'a = 2\n');
    const catalogs = readCatalogsByLocale(dir);
    assert.deepEqual([...Object.keys(catalogs)].sort(), ['__proto__', 'en']);
    const report = checkCatalogs(catalogs);
    assert.deepEqual([...report.locales].sort(), ['__proto__', 'en']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watchCatalogs with unref regenerates without holding the event loop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-watch-'));
  const output = path.join(dir, 'types', 'fluent.d.ts');
  try {
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'a = 1\n');
    const stop = watchCatalogs(dir, output, { unref: true, intervalMs: 20 });
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'a = 1\nb = 2\n');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.match(fs.readFileSync(output, 'utf8'), /'b'/, 'regeneration missed the new message');
    stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
