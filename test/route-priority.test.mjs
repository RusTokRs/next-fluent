import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation } from '../dist/navigation.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { buildAlternateLinksHeader } from '../dist/alternate-links.js';
import { findInternalPath } from '../dist/route-engine.js';

const routes = [
  ['/docs/[[...rest]]', { en: '/docs/[[...rest]]', ru: '/optional/[[...rest]]' }],
  ['/docs/[...slug]', { en: '/docs/[...slug]', ru: '/many/[...slug]' }],
  ['/docs/[id]', { en: '/docs/[id]', ru: '/one/[id]' }],
  ['/docs/new', { en: '/docs/new', ru: '/new-document' }],
  ['/docs', { en: '/docs', ru: '/documents' }],
];
const cases = [
  ['/docs', '/docs', {}, '/ru/documents'],
  ['/docs/new', '/docs/new', {}, '/ru/new-document'],
  ['/docs/42', '/docs/[id]', { id: '42' }, '/ru/one/42'],
  ['/docs/a/b', '/docs/[...slug]', { slug: ['a', 'b'] }, '/ru/many/a/b'],
];
const config = (pathnames) => ({ locales: ['en', 'ru'], defaultLocale: 'en', pathnames });

function* permutations(items) {
  if (items.length === 0) { yield []; return; }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations(items.filter((_, index) => i !== index))) yield [items[i], ...rest];
  }
}

test('static, single, required and optional catch-all priority is independent of declaration order', () => {
  // All 120 orders, not just the originally failing/reversed pair.
  for (const order of permutations(routes)) {
    const pathnames = Object.fromEntries(order);
    const nav = createNavigation(config(pathnames));
    for (const [path, template, params, href] of cases) {
      assert.deepEqual(findInternalPath(path, 'en', pathnames), { template, params });
      assert.equal(nav.getPathname({ href: path, locale: 'ru' }), href);
    }
  }
});

test('optional catch-all still matches its empty tail without a concrete parent', () => {
  const pathnames = Object.fromEntries(routes.slice(0, 3));
  assert.deepEqual(findInternalPath('/docs', 'en', pathnames), {
    template: '/docs/[[...rest]]', params: { rest: [] },
  });
  assert.equal(createNavigation(config(pathnames)).getPathname({ href: '/docs', locale: 'ru' }), '/ru/optional');
});

test('segment position matters more than the total number of static segments', () => {
  const entries = [
    ['/[section]/fixed/end', { en: '/[section]/fixed/end', ru: '/generic/[section]/fixed/end' }],
    ['/docs/[...slug]', { en: '/docs/[...slug]', ru: '/documents/[...slug]' }],
  ];
  for (const order of [entries, [...entries].reverse()]) {
    const pathnames = Object.fromEntries(order);
    assert.deepEqual(findInternalPath('/docs/fixed/end', 'en', pathnames), {
      template: '/docs/[...slug]', params: { slug: ['fixed', 'end'] },
    });
    assert.equal(createNavigation(config(pathnames)).getPathname({ href: '/docs/fixed/end', locale: 'ru' }),
      '/ru/documents/fixed/end');
  }
});

test('public matches use the localized template priority, not the internal key priority', () => {
  const entries = [
    ['/deep/tree/[...slug]', { en: '/public/[...slug]', ru: '/vse/[...slug]' }],
    ['/[id]', { en: '/public/[id]', ru: '/odin/[id]' }],
  ];
  for (const order of [entries, [...entries].reverse()]) {
    const pathnames = Object.fromEntries(order);
    assert.deepEqual(findInternalPath('/public/42', 'en', pathnames), {
      template: '/[id]', params: { id: '42' },
    });
    // A known localized route still wins over an internal fallback.
    assert.deepEqual(findInternalPath('/public/a/b', 'en', pathnames), {
      template: '/deep/tree/[...slug]', params: { slug: ['a', 'b'] },
    });
  }
});

test('explicit route templates are not swallowed by more-specific dynamic siblings', () => {
  const nav = createNavigation(config(Object.fromEntries(routes)));
  assert.equal(nav.getPathname({ locale: 'ru', href: {
    pathname: '/docs/[...slug]', query: { slug: ['a', 'b'], page: 2 }, hash: 'details',
  } }), '/ru/many/a/b?page=2#details');
  assert.equal(nav.getPathname({ locale: 'ru', href: {
    pathname: '/docs/[[...rest]]', query: { rest: ['a', 'b'] },
  } }), '/ru/optional/a/b');
  assert.equal(nav.getPathname({ locale: 'ru', href: {
    pathname: '/docs/[id]', query: { id: 'a/b', q: 'x' },
  } }), '/ru/one/a%2Fb?q=x');
  assert.equal(nav.getPathname({ locale: 'ru', href: '/docs/a%2Fb/?q=x#details' }),
    '/ru/one/a%2Fb/?q=x#details');
});

test('middleware and hreflang resolve the same most-specific internal route', async () => {
  const entries = [
    ['/deep/tree/[...slug]', { en: '/docs/[...slug]', ru: '/dokumenty/[...slug]' }],
    ['/one/[id]', { en: '/docs/[id]', ru: '/dokumenty/[id]' }],
  ];
  for (const order of [entries, [...entries].reverse()]) {
    const pathnames = Object.fromEntries(order);
    const middleware = createI18nMiddleware(config(pathnames));
    const url = new URL('https://example.test/ru/dokumenty/42?q=1');
    const result = await middleware({ url: url.href, nextUrl: { pathname: url.pathname, search: url.search },
      headers: new Headers({ host: url.host }), cookies: { get: () => undefined } });
    assert.equal(result.headers.get('location'), null);
    assert.equal(result.headers.get('x-middleware-rewrite'), 'https://example.test/ru/one/42?q=1');
  }
  const header = buildAlternateLinksHeader({ ...config(Object.fromEntries(routes)),
    pathname: '/docs/42', origin: 'https://example.test', search: '?q=1',
  });
  assert.match(header, /<https:\/\/example.test\/ru\/one\/42\?q=1>; rel="alternate"; hreflang="ru"/);
  assert.doesNotMatch(header, /\/many\/|\/optional\//);
});


test('an explicit internal parameterized template takes precedence over a public catch-all', () => {
  const pathnames = {
    '/fallback/[...slug]': { en: '/all/[...slug]', ru: '/[...slug]' },
    '/docs/[id]': { en: '/docs/[id]', ru: '/odin/[id]' },
  };
  assert.equal(createNavigation(config(pathnames)).getPathname({ locale: 'ru', href: {
    pathname: '/docs/[id]', query: { id: '42' },
  } }), '/ru/odin/42');
  // Concrete public URLs still take precedence over internal fallbacks.
  assert.deepEqual(findInternalPath('/docs/42', 'ru', pathnames), {
    template: '/fallback/[...slug]', params: { slug: ['docs', '42'] },
  });
});
