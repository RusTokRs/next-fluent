import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@fluent/syntax';
import {
  clearBundleCache,
  createFluentBundle,
  createI18n,
  createTranslator,
  generateTypeDeclarations,
  pseudoLocalizeFtl,
} from '../dist/index.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { resolveLocalizedPathname } from '../dist/navigation.js';
import { forLocale, setRequestConfig, setRequestLocale } from '../dist/server.js';

const config = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
  pathnames: {
    '/about': { en: '/about-us', ru: '/o-nas' },
    '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]' },
  },
};

function request(pathname, extras = {}) {
  return {
    url: `https://${extras.host ?? 'example.com'}${pathname}`,
    nextUrl: { pathname, search: '' },
    cookies: { get: () => undefined },
    headers: new Headers(),
  };
}

test('hash collisions never reuse another FTL resource or bundle', () => {
  clearBundleCache();
  const first = createTranslator(createFluentBundle('en', 'key = 0jebqzk'));
  const second = createTranslator(createFluentBundle('en', 'key = 1i10qdw'));
  assert.equal(first('key'), '0jebqzk');
  assert.equal(second('key'), '1i10qdw');
});

test('localized static and dynamic URLs rewrite to internal app routes', async () => {
  const middleware = createI18nMiddleware(config);
  const staticResponse = await middleware(request('/ru/o-nas'));
  const dynamicResponse = await middleware(request('/ru/tovary/123'));
  assert.equal(staticResponse.headers.get('x-middleware-rewrite'), 'https://example.com/ru/about');
  assert.equal(dynamicResponse.headers.get('x-middleware-rewrite'), 'https://example.com/ru/products/123');
});

test('locale switches and dynamic URL objects use the same route model', () => {
  assert.equal(resolveLocalizedPathname({ href: '/ru/o-nas', locale: 'en' }, config), '/en/about-us');
  assert.equal(resolveLocalizedPathname({ href: '/products/123', locale: 'ru' }, config), '/ru/tovary/123');
  assert.equal(resolveLocalizedPathname({
    href: { pathname: '/products/[id]', query: { id: 123, tab: 'reviews' } },
    locale: 'ru',
  }, config), '/ru/tovary/123?tab=reviews');
});

test('catch-all and optional catch-all routes localize and rewrite', async () => {
  const catchAll = {
    ...config,
    pathnames: {
      '/docs/[...slug]': { en: '/docs/[...slug]', ru: '/dokumenty/[...slug]' },
      '/archive/[[...slug]]': { en: '/archive/[[...slug]]', ru: '/arhiv/[[...slug]]' },
    },
  };
  assert.equal(resolveLocalizedPathname({ href: '/docs/a/b', locale: 'ru' }, catchAll), '/ru/dokumenty/a/b');
  assert.equal(resolveLocalizedPathname({ href: '/archive', locale: 'ru' }, catchAll), '/ru/arhiv');
  const response = await createI18nMiddleware(catchAll)(request('/ru/dokumenty/a/b'));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://example.com/ru/docs/a/b');
});

test('URL objects cannot turn an internal pathname into a protocol-relative URL', () => {
  assert.throws(() => resolveLocalizedPathname({
    href: { pathname: '//evil.example/path' }, locale: 'en',
  }, { ...config, localePrefix: 'as-needed' }), /internal path/);
});

test('createI18n instances keep their own message loaders', async () => {
  const a = createI18n({ locales: ['en'], defaultLocale: 'en', loadMessages: () => 'msg = A' });
  const b = createI18n({ locales: ['en'], defaultLocale: 'en', loadMessages: () => 'msg = B' });
  assert.equal((await a.forLocale('en'))('msg'), 'A');
  assert.equal((await b.forLocale('en'))('msg'), 'B');
});

test('request config fallback messages are used by server translations', async () => {
  setRequestConfig(() => ({
    locale: 'ru',
    messages: 'hello = Привет',
    fallbackLocale: 'en',
    fallbackMessages: 'only = Only',
  }));
  const t = await forLocale('ru');
  assert.equal(t('only'), 'Only');
});

test('request locale rejects invalid BCP 47 input', () => {
  assert.throws(() => setRequestLocale('../private'), /Invalid request locale/);
});

test('type generation scopes variables to each value and attribute', () => {
  const d = String.fromCharCode(36);
  const output = generateTypeDeclarations(`profile = Hello { ${d}name }\n  .title = { ${d}count } items`);
  assert.match(output, /'profile': \{ 'name': string \| number \| Date \}/);
  assert.match(output, /'profile.title': \{ 'count': string \| number \| Date \}/);
});

test('pseudo-localization transforms text nodes while keeping complex FTL valid', () => {
  const d = String.fromCharCode(36);
  const input = `items = { ${d}count ->\n    [one] One item\n   *[other] { ${d}count } items\n}`;
  const output = pseudoLocalizeFtl(input);
  assert.equal(parse(output).body.some((entry) => entry.type === 'Junk'), false);
  assert.match(output, /\{ \$count ->/);
});

test('domain and basePath routing have matching navigation and middleware behavior', async () => {
  const domainConfig = {
    ...config,
    basePath: '/app',
    domains: [
      { domain: 'en.example.com', defaultLocale: 'en', locales: ['en'] },
      { domain: 'ru.example.com', defaultLocale: 'ru', locales: ['ru'] },
    ],
  };
  assert.equal(
    resolveLocalizedPathname({ href: '/about', locale: 'ru' }, domainConfig),
    'https://ru.example.com/app/ru/o-nas'
  );
  const response = await createI18nMiddleware(domainConfig)(request('/app/ru/o-nas', { host: 'ru.example.com' }));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://ru.example.com/app/ru/about');
  const wrongDomain = await createI18nMiddleware(domainConfig)(request('/app/ru/o-nas', { host: 'en.example.com' }));
  assert.equal(wrongDomain.headers.get('location'), 'https://ru.example.com/app/ru/o-nas');
});

test('untrusted forwarded hosts cannot change redirect origin', async () => {
  const req = request('/en/about-us');
  req.headers.set('host', 'example.com');
  req.headers.set('x-forwarded-host', 'evil.example');
  const response = await createI18nMiddleware({ ...config, localePrefix: 'as-needed' })(req);
  assert.equal(response.headers.get('location'), 'https://example.com/about-us');
});
