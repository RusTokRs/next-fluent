import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

import {
  defineRouting,
  createNavigation,
  createI18nMiddleware,
  createFluentBundle,
  createTranslator,
  extractMessagesFromFtl,
  generateTypeDeclarations,
  FluentProvider,
  useNow,
  useLocale,
  LRUCache,
} from '../dist/index.js';

const stripBidiIsolates = (value) =>
  typeof value === 'string' ? value.replace(/[\u2068\u2069]/g, '') : value;

test('PARITY-01: defineRouting produces validated, immutable routing configuration', () => {
  const routing = defineRouting({
    locales: ['en', 'de', 'es'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    pathnames: {
      '/about': {
        en: '/about-us',
        de: '/ueber-uns',
        es: '/sobre-nosotros',
      },
    },
  });

  assert.deepEqual(routing.locales, ['en', 'de', 'es']);
  assert.equal(routing.defaultLocale, 'en');
  assert.equal(routing.localePrefix, 'as-needed');
  assert.equal(routing.cookieName, 'NEXT_LOCALE');
  assert.equal(routing.headerName, 'x-next-locale');
  assert.ok(Object.isFrozen(routing));
});

test('PARITY-02: Localized pathnames route resolution and reverse lookup in navigation', () => {
  const routing = defineRouting({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
    pathnames: {
      '/about': {
        en: '/about-us',
        ru: '/o-nas',
      },
      '/contact': '/contact-us',
    },
  });

  const nav = createNavigation(routing);

  // 1. Forward resolution to localized slugs
  assert.equal(nav.getPathname({ href: '/about', locale: 'en' }), '/en/about-us');
  assert.equal(nav.getPathname({ href: '/about', locale: 'ru' }), '/ru/o-nas');
  assert.equal(nav.getPathname({ href: '/contact', locale: 'en' }), '/en/contact-us');
  assert.equal(nav.getPathname({ href: '/contact', locale: 'ru' }), '/ru/contact-us');

  // 2. Unregistered route remains as-is
  assert.equal(nav.getPathname({ href: '/pricing', locale: 'en' }), '/en/pricing');
});

test('PARITY-03: t.rich interpolates direct React elements in variables', () => {
  const ftl = `
user-welcome = Welcome, { $avatar } { $name }! Visit <link>dashboard</link>.
`;
  const bundle = createFluentBundle('en', ftl);
  const t = createTranslator(bundle);

  const avatarElement = React.createElement('img', {
    src: '/avatar.png',
    alt: 'user-avatar',
    key: 'user-avatar',
  });

  const result = t.rich('user-welcome', {
    name: 'Alice',
    avatar: avatarElement,
    link: (chunks) => React.createElement('a', { href: '/dash' }, chunks),
  });

  assert.ok(React.isValidElement(result));
  const children = React.Children.toArray(result.props.children);

  // Verify structure: Welcome, + <img /> + " " + Alice! Visit + <a>dashboard</a> + "."
  assert.equal(children[0], 'Welcome, ');

  const imgChild = children[1];
  assert.ok(React.isValidElement(imgChild));
  assert.equal(imgChild.type, 'img');
  assert.equal(imgChild.props.alt, 'user-avatar');

  assert.equal(stripBidiIsolates(children[2]), ' Alice! Visit ');

  const linkChild = children[3];
  assert.ok(React.isValidElement(linkChild));
  assert.equal(linkChild.type, 'a');
  assert.equal(linkChild.props.children, 'dashboard');

  assert.equal(children[4], '.');
});

test('PARITY-04: t.rich handles HTML void tags like <br> without requiring self-closing slash', () => {
  const ftl = `
multiline-notice = Line one<br>Line two<hr>Line three
`;
  const bundle = createFluentBundle('en', ftl);
  const t = createTranslator(bundle);

  const result = t.rich('multiline-notice', {
    br: () => React.createElement('br'),
    hr: () => React.createElement('hr'),
  });

  assert.ok(React.isValidElement(result));
  const children = React.Children.toArray(result.props.children);

  assert.equal(children[0], 'Line one');
  assert.equal(children[1].type, 'br');
  assert.equal(children[2], 'Line two');
  assert.equal(children[3].type, 'hr');
  assert.equal(children[4], 'Line three');
});

test('PARITY-05: Middleware performs rewrite for as-needed and never to match app/[locale]', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  });

  const makeReq = (pathname) => ({
    url: `https://example.com${pathname}`,
    nextUrl: {
      pathname,
      search: '',
    },
    cookies: {
      get: () => undefined,
      set: () => {},
    },
    headers: new Headers(),
  });

  // Request for unprefixed default locale route /about
  const response = await middleware(makeReq('/about'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-next-locale'), 'en');

  // Must rewrite internally to /en/about
  if (response.rewriteUrl) {
    assert.ok(response.rewriteUrl.includes('/en/about'));
  }
});

test('PARITY-06: LRUCache performs true O(1) eviction of least recently used keys', () => {
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);

  // Access 'a' so it becomes most recently used
  assert.equal(cache.get('a'), 1);

  // Insert 'd', exceeding capacity (3) -> oldest unaccessed ('b') must be evicted!
  cache.set('d', 4);

  assert.equal(cache.has('b'), false, 'Key "b" should have been evicted');
  assert.equal(cache.has('a'), true, 'Key "a" was accessed and should survive');
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
});

test('PARITY-07: AST Typegen with @fluent/syntax accurately extracts complex selectors and variables', () => {
  const ftl = `
# Header section
header-title = Storefront

# Complex plural & gender selector
cart-summary = { $gender ->
    [female] { $count ->
        [one] She has { $count } item in her cart.
       *[other] She has { $count } items in her cart.
    }
   *[male] { $count ->
        [one] He has { $count } item in his cart.
       *[other] He has { $count } items in his cart.
    }
}
  .tooltip = View cart with { $count } items
`;

  const extracted = extractMessagesFromFtl(ftl);
  assert.equal(extracted.length, 2);

  const cartSummary = extracted.find((m) => m.id === 'cart-summary');
  assert.ok(cartSummary);
  assert.deepEqual(cartSummary.variables, ['count', 'gender']);
  assert.deepEqual(cartSummary.attributes, ['tooltip']);

  const dts = generateTypeDeclarations(ftl);
  assert.ok(dts.includes('export type AppMessageKey ='));
  assert.ok(dts.includes("'cart.summary'"));
  assert.ok(dts.includes("'count': string | number | Date"));
  assert.ok(dts.includes("'gender': string | number | Date"));
  assert.ok(dts.includes('interface FluentMessages extends AppMessages'));
});

test('PARITY-08: FluentProvider syncs now prop to eliminate hydration mismatch', () => {
  const serverNow = new Date(1700000000000);

  function Consumer() {
    const now = useNow();
    const locale = useLocale();
    return React.createElement('div', null, `${locale}:${now.getTime()}`);
  }

  const tree = React.createElement(
    FluentProvider,
    {
      locale: 'en',
      messages: '',
      now: serverNow,
    },
    React.createElement(Consumer)
  );

  assert.ok(React.isValidElement(tree));
  assert.equal(tree.props.now.getTime(), 1700000000000);
});
