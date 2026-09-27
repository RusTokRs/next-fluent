import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { FluentProvider } from '../dist/client.js';
import { defineRouting } from '../dist/routing.js';
import { createNavigation } from '../dist/navigation.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { buildAlternateLinksHeader } from '../dist/alternate-links.js';
import { switchLocaleHref } from '../dist/nav-url.js';

const config = {
  locales: ['en', 'ru', 'de'],
  defaultLocale: 'en',
  localePrefix: 'always',
  basePath: '/app',
  localeDetection: false,
  pathnames: { '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]', de: '/produkte/[id]' } },
  domains: [
    { domain: 'example.com', defaultLocale: 'en', localePrefix: 'never' },
    {
      domain: 'example.eu', defaultLocale: 'de', locales: ['de', 'ru'],
      localePrefix: { mode: 'as-needed', prefixes: { de: '/deutsch', ru: '/russian' } },
    },
  ],
};

function request(path, host, headers = {}, origin = 'http://localhost:3000') {
  const url = new URL(path, origin);
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    headers: new Headers({ host, ...headers }),
    cookies: { get: () => undefined },
  };
}

function alternates(header) {
  return Object.fromEntries([...header.matchAll(/<([^>]+)>; rel="alternate"; hreflang="([^"]+)"/g)]
    .map(([, href, locale]) => [locale, href]));
}

for (const global of ['always', 'as-needed', 'never']) {
  for (const override of ['always', 'as-needed', 'never']) {
    test(`domain ${override} overrides global ${global} in navigation and middleware`, async () => {
      const routing = {
        locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: global,
        localeDetection: false,
        domains: [{ domain: 'example.ru', defaultLocale: 'ru', locales: ['en', 'ru'], localePrefix: override }],
      };
      const nav = createNavigation(routing);
      const middleware = createI18nMiddleware(routing);
      for (const locale of ['en', 'ru']) {
        const prefix = override === 'always' || (override === 'as-needed' && locale !== 'ru') ? `/${locale}` : '';
        const pathname = `${prefix}/docs`;
        assert.equal(nav.getPathname({ href: '/docs', locale }), `https://example.ru${pathname}`);
        assert.equal(nav.getPathname({ href: '/docs', locale, domain: 'EXAMPLE.RU' }), pathname);
        assert.equal(nav.getPathname({ href: '/', locale, forcePrefix: true }),
          `https://example.ru${override === 'never' ? '/' : `/${locale}`}`);
      }
      const canonical = override === 'always' ? '/ru/docs' : '/docs';
      const response = await middleware(request(canonical, 'example.ru'));
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('x-next-locale'), 'ru');
      if (override !== 'always') {
        assert.equal(response.headers.get('x-middleware-rewrite'), 'http://localhost:3000/ru/docs');
      }
    });
  }
}

test('domain prefix maps replace the global map, and omitted domain settings inherit it', async () => {
  const routing = {
    locales: ['en', 'ru'], defaultLocale: 'en', localeDetection: false,
    localePrefix: { mode: 'always', prefixes: { en: '/english', ru: '/rus' } },
    domains: [
      { domain: 'inherit.test', defaultLocale: 'ru' },
      { domain: 'override.test', defaultLocale: 'en', localePrefix: { prefixes: { en: '/eng' } } },
    ],
  };
  const nav = createNavigation(routing);
  assert.equal(nav.getPathname({ href: '/docs', locale: 'ru' }), 'https://inherit.test/rus/docs');
  assert.equal(nav.getPathname({ href: '/docs', locale: 'en' }), 'https://override.test/eng/docs');
  const mw = createI18nMiddleware(routing);
  assert.equal((await mw(request('/docs', 'inherit.test'))).headers.get('location'), 'http://inherit.test/rus/docs');
  assert.equal((await mw(request('/docs', 'unknown.test'))).headers.get('location'), 'http://unknown.test/english/docs');
  const replaced = createNavigation({ ...routing, domains: [{ ...routing.domains[1], localePrefix: 'always' }] });
  assert.equal(replaced.getPathname({ href: '/docs', locale: 'en' }), 'https://override.test/en/docs');
});

test('navigation uses source prefixes, target defaults, basePath, params, search and hash', () => {
  const nav = createNavigation(config);
  assert.equal(nav.getPathname({ href: '/app/russian/tovary/42/?q=1#details', locale: 'en', domain: 'example.eu' }),
    'https://example.com/app/products/42/?q=1#details');
  assert.equal(nav.getPathname({ href: { pathname: '/products/[id]', query: { id: 42, q: 'x' } }, locale: 'ru' }),
    'https://example.eu/app/russian/tovary/42?q=x');
  assert.equal(nav.getPathname({ href: '/products/42', locale: 'de' }), 'https://example.eu/app/produkte/42');
  assert.equal(nav.getPathname({ href: '/products/42', domain: 'example.eu' }), '/app/produkte/42');
  assert.equal(nav.getPathname({ href: '/', locale: 'de', forcePrefix: true }), 'https://example.eu/app/deutsch');
  assert.equal(nav.getPathname({ href: '/', locale: 'en', forcePrefix: true }), 'https://example.com/app');
  assert.throws(() => nav.redirect('/products/42', { locale: 'de' }), (error) =>
    error.digest === 'NEXT_REDIRECT;replace;https://example.eu/app/produkte/42;307;');
  assert.throws(() => nav.permanentRedirect({ href: '/products/42', locale: 'ru' }), (error) =>
    error.digest === 'NEXT_REDIRECT;replace;https://example.eu/app/russian/tovary/42;308;');
});

test('current domain wins when several domains serve a locale', () => {
  const routing = {
    locales: ['en'], defaultLocale: 'en',
    domains: [
      { domain: 'first.test', defaultLocale: 'en', localePrefix: 'always' },
      { domain: 'second.test:8443', defaultLocale: 'en', localePrefix: 'never' },
    ],
  };
  assert.equal(createNavigation(routing).getPathname({ href: '/docs', domain: 'SECOND.TEST:8443' }), '/docs');
});

test('domain locale aliases resolve to global canonical spellings', async () => {
  const routing = {
    locales: ['en', 'pt-BR'], defaultLocale: 'en', localeDetection: false,
    domains: [{ domain: 'example.br', defaultLocale: 'pt_br', locales: ['pt_br'],
      localePrefix: { mode: 'as-needed', prefixes: { 'pt-br': '/br' } } }],
  };
  const nav = createNavigation(routing);
  assert.equal(nav.getPathname({ href: '/docs', locale: 'pt_BR' }), 'https://example.br/docs');
  const result = await createI18nMiddleware(routing)(request('/br/docs', 'example.br'));
  assert.equal(result.headers.get('location'), 'http://example.br/docs');
  assert.equal(result.headers.get('x-next-locale'), 'pt-BR');
});

test('middleware uses per-domain rules and cross-domain canonical prefixes', async () => {
  const mw = createI18nMiddleware(config);
  const english = await mw(request('/app/products/42?q=1', 'example.com'));
  assert.equal(english.headers.get('location'), null);
  assert.equal(english.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/en/products/42?q=1');
  const german = await mw(request('/app/produkte/42', 'example.eu'));
  assert.equal(german.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/de/products/42');
  const russian = await mw(request('/app/russian/tovary/42', 'example.eu'));
  assert.equal(russian.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/ru/products/42');
  const stripped = await mw(request('/app/deutsch/produkte/42?q=1', 'example.eu'));
  assert.equal(stripped.headers.get('location'), 'http://example.eu/app/produkte/42?q=1');
  for (const prefix of ['ru', 'russian']) {
    const moved = await mw(request(`/app/${prefix}/products/42?q=1`, 'example.com'));
    assert.equal(moved.headers.get('location'), 'http://example.eu/app/russian/tovary/42?q=1');
  }
  const moved = await mw(request('/app/en/products/42?q=1', 'example.eu'));
  assert.equal(moved.headers.get('location'), 'http://example.com/app/products/42?q=1');
});

test('domain config validates modes, maps and domain-local locale membership at every entry point', () => {
  const badPrefixes = ['sometimes', { mode: 'sometimes' }, { prefixes: { en: 'english' } },
    { prefixes: { en: '/english/' } }, { prefixes: { en: '/a/../b' } },
    { prefixes: { en: '/same', ru: '/same' } }, { prefixes: { de: '/deutsch' } }];
  for (const localePrefix of badPrefixes) {
    const routing = { locales: ['en', 'ru', 'de'], defaultLocale: 'en',
      domains: [{ domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'], localePrefix }] };
    for (const factory of [defineRouting, createNavigation, createI18nMiddleware]) {
      assert.throws(() => factory(routing), /localePrefix|locale prefix/, JSON.stringify(localePrefix));
    }
  }
  assert.doesNotThrow(() => defineRouting(config));
});

test('Link and usePathname respect domain-specific custom prefixes', () => {
  const nav = createNavigation(config);
  function Pathname() { return React.createElement('span', null, nav.usePathname()); }
  const html = renderToStaticMarkup(React.createElement(FluentProvider, { locale: 'ru', messages: 'x = X' },
    React.createElement(PathnameContext.Provider, { value: '/app/russian/tovary/42/' },
      React.createElement(React.Fragment, null,
        React.createElement(Pathname),
        React.createElement(nav.Link, { href: '/products/42', locale: 'de' }, 'German')))));
  assert.match(html, /<span>\/products\/42\/<\/span>/);
  assert.match(html, /href="https:\/\/example.eu\/app\/deutsch\/produkte\/42"/);
});

test('router methods and locale-switch signal URLs use domain prefix modes', () => {
  const nav = createNavigation(config);
  let router;
  function Probe() { router = nav.useRouter(); return null; }
  const calls = [];
  const nextRouter = Object.fromEntries(['push', 'replace', 'prefetch'].map((name) =>
    [name, (...args) => calls.push([name, ...args])]));
  renderToStaticMarkup(React.createElement(FluentProvider, { locale: 'en', messages: 'x = X' },
    React.createElement(AppRouterContext.Provider, { value: nextRouter }, React.createElement(Probe))));
  router.push('/products/42', { locale: 'de' });
  router.replace('/products/42', { locale: 'ru' });
  router.prefetch('/products/42', { locale: 'en' });
  assert.deepEqual(calls, [
    ['push', 'https://example.eu/app/deutsch/produkte/42', undefined],
    ['replace', 'https://example.eu/app/russian/tovary/42', undefined],
  ]);
  assert.equal(switchLocaleHref('/app/produkte/42', 'de', config), '/app/deutsch/produkte/42');
  assert.equal(switchLocaleHref('/app/russian/tovary/42', 'ru', config), '/app/russian/tovary/42');
  assert.equal(switchLocaleHref('/app/products/42', 'en', config), '/app/en/products/42');
});

test('alternates include all domains, even when the current domain is single-locale never', async () => {
  const response = await createI18nMiddleware(config)(request('/app/products/42?q=1', 'example.com'));
  assert.deepEqual(alternates(response.headers.get('link')), {
    en: 'https://example.com/app/products/42?q=1',
    ru: 'https://example.eu/app/russian/tovary/42?q=1',
    de: 'https://example.eu/app/produkte/42?q=1',
  });
  const disabled = await createI18nMiddleware({ ...config, alternateLinks: false })(request('/app/products/42', 'example.com'));
  assert.equal(disabled.headers.get('link'), null);
});

test('global never emits domain alternates without accidentally prefixing non-default locales', () => {
  const header = buildAlternateLinksHeader({
    locales: ['en', 'ru', 'de'], defaultLocale: 'en', localePrefix: 'never',
    pathname: '/products/42', pathnames: config.pathnames,
    origin: 'https://example.com', basePath: '/app', search: '?q=1',
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
      { domain: 'example.de', defaultLocale: 'de', localePrefix: 'always' },
    ],
  });
  assert.deepEqual(alternates(header), {
    en: 'https://example.com/app/products/42?q=1',
    ru: 'https://example.com/app/tovary/42?q=1',
    de: 'https://example.de/app/de/produkte/42?q=1',
  });
});

test('never alternates omit ambiguous URLs, single locales and x-default pointing to an ambiguity', () => {
  const options = { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never',
    pathname: '/about', origin: 'https://example.com' };
  assert.equal(buildAlternateLinksHeader(options), undefined);
  assert.equal(buildAlternateLinksHeader({ ...options, locales: ['en'] }), undefined);
  assert.deepEqual(alternates(buildAlternateLinksHeader({ ...options,
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
  })), { en: 'https://example.com/about-us', ru: 'https://example.com/o-nas', 'x-default': 'https://example.com/about-us' });
  const header = buildAlternateLinksHeader({ ...options, locales: ['en', 'ru', 'de', 'fr'],
    pathnames: { '/about': { en: '/same', ru: '/same', de: '/uber', fr: '/apropos' } },
  });
  assert.deepEqual(alternates(header), { de: 'https://example.com/uber', fr: 'https://example.com/apropos' });
});

test('Host and trusted forwarded host replace the old port, but configured ports are retained', async () => {
  const mw = createI18nMiddleware(config);
  for (const headers of [{}, { 'x-forwarded-host': 'example.com' }]) {
    const response = await mw(request('/app/products/42', headers['x-forwarded-host'] ? 'localhost:3000' : 'example.com', headers));
    assert.equal(response.headers.get('x-next-locale'), 'en');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/en/products/42');
  }
  // Rewrites intentionally stay on request.url's origin; only public URLs use Host.
  const canonical = await mw(request('/app/en/products/42', 'example.com'));
  assert.equal(canonical.headers.get('location'), 'http://example.com/app/products/42');
  const portConfig = { ...config, domains: [
    { ...config.domains[0], domain: 'example.com:8080' }, config.domains[1],
  ] };
  const portMw = createI18nMiddleware(portConfig);
  const direct = await portMw(request('/app/products/42', 'example.com:8080'));
  assert.equal(direct.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/en/products/42');
  const outbound = await portMw(request('/app/ru/products/42?q=1', 'example.com:8080'));
  assert.equal(outbound.headers.get('location'), 'http://example.eu/app/russian/tovary/42?q=1');
  const inbound = await portMw(request('/app/en/products/42', 'example.eu'));
  assert.equal(inbound.headers.get('location'), 'http://example.com:8080/app/products/42');
  const untrusted = await mw(request('/app/products/42', 'example.com', { 'x-forwarded-host': 'evil.example' }));
  assert.equal(untrusted.headers.get('x-middleware-rewrite'), 'http://localhost:3000/app/en/products/42');
  const rejected = await createI18nMiddleware({ ...config, trustedHosts: ['example.com'] })(request('/app/products/42', 'evil.example'));
  assert.equal(rejected.status, 421);
});

test('global never advertises identical paths on distinct single-locale domains', async () => {
  const routing = {
    locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never', localeDetection: false,
    domains: [
      { domain: 'example.com', defaultLocale: 'en' },
      { domain: 'example.ru', defaultLocale: 'ru' },
    ],
  };
  const mw = createI18nMiddleware(routing);
  for (const host of ['example.com', 'example.ru']) {
    const response = await mw(request('/docs?q=1', host));
    assert.equal(response.headers.get('location'), null);
    assert.deepEqual(alternates(response.headers.get('link')), {
      en: 'https://example.com/docs?q=1', ru: 'https://example.ru/docs?q=1',
    });
  }
});

test('cross-domain redirect to as-needed default omits its custom prefix', async () => {
  const response = await createI18nMiddleware(config)(request('/app/de/produkte/42?q=1', 'example.com'));
  assert.equal(response.headers.get('location'), 'http://example.eu/app/produkte/42?q=1');
});

test('real NextRequest basePath is restored, while rewrites stay on the backend origin', async () => {
  const { NextRequest } = await import('next/server.js');
  const mw = createI18nMiddleware(config);
  const req = new NextRequest('https://backend.internal:3000/app/russian/tovary/42?q=1', {
    nextConfig: { basePath: '/app' }, headers: { host: 'example.eu' },
  });
  assert.equal(req.nextUrl.pathname, '/russian/tovary/42');
  assert.equal(req.nextUrl.basePath, '/app');
  const result = await mw(req);
  assert.equal(result.headers.get('x-middleware-rewrite'), 'https://backend.internal:3000/app/ru/products/42?q=1');
  assert.equal(result.request.headers.get('x-next-fluent-rewrite'), '/ru/products/42');
  assert.match(result.headers.get('link'), /https:\/\/example.eu\/app\/russian\/tovary\/42\?q=1/);
  const redirect = await mw(new NextRequest('https://backend.internal:3000/app/deutsch/produkte/42?q=1', {
    nextConfig: { basePath: '/app' }, headers: { host: 'example.eu' },
  }));
  assert.equal(redirect.headers.get('location'), 'https://example.eu/app/produkte/42?q=1');
  // A route itself can begin with the same segment as basePath.
  const nested = await mw(new NextRequest('https://backend.internal:3000/app/app/docs', {
    nextConfig: { basePath: '/app' }, headers: { host: 'example.eu' },
  }));
  assert.equal(nested.headers.get('x-middleware-rewrite'), 'https://backend.internal:3000/app/de/app/docs');
});

for (const mode of ['always', 'as-needed', 'never']) {
  test(`custom ${mode} prefixes rewrite to canonical locale segments, including untranslated paths`, async () => {
    const routing = { locales: ['en', 'ru'], defaultLocale: 'en', localeDetection: false,
      localePrefix: { mode, prefixes: { en: '/english', ru: '/language/russian' } } };
    const mw = createI18nMiddleware(routing);
    const publicPath = mode === 'always' ? '/english/shared' : '/shared';
    const result = await mw(request(publicPath, 'localhost:3000'));
    assert.equal(result.headers.get('x-middleware-rewrite'), 'http://localhost:3000/en/shared');
    const second = await mw(request('/en/shared', 'localhost:3000', { 'x-next-fluent-rewrite': '/en/shared' }));
    assert.equal(second.headers.get('location'), null);
    assert.equal(second.headers.get('x-middleware-rewrite'), null);
    const router = await mw(request('/en/shared', 'localhost:3000', { 'sec-fetch-dest': 'empty' }));
    assert.equal(router.headers.get('location'), null);
    assert.equal(router.headers.get('x-middleware-rewrite'), null);
    const doc = await mw(request('/en/shared', 'localhost:3000', { 'sec-fetch-dest': 'document' }));
    assert.equal(doc.headers.get('location'), `http://localhost:3000${publicPath}`);
    // A public signal URL is not an internal rewrite target, even for router fetches.
    if (mode !== 'always') {
      const signal = await mw(request('/english/shared', 'localhost:3000', { 'sec-fetch-dest': 'empty' }));
      assert.equal(signal.headers.get('location'), 'http://localhost:3000/shared');
    }
  });
}

test('usePathname hides internal locale segments returned by Next after a custom-prefix rewrite', () => {
  const nav = createNavigation(config);
  function Pathname() { return React.createElement('span', null, nav.usePathname()); }
  const html = renderToStaticMarkup(React.createElement(FluentProvider, { locale: 'ru', messages: 'x = X' },
    React.createElement(PathnameContext.Provider, { value: '/app/ru/products/42' }, React.createElement(Pathname))));
  assert.equal(html, '<span>/products/42</span>');
});

test('absolute configured multi-locale links signal a switch, but unrelated external links do not', () => {
  assert.equal(switchLocaleHref('https://example.eu/app/produkte/42?q=1#details', 'de', config),
    'https://example.eu/app/deutsch/produkte/42?q=1#details');
  assert.equal(switchLocaleHref('https://example.eu/app/russian/tovary/42', 'ru', config),
    'https://example.eu/app/russian/tovary/42');
  const never = { ...config, domains: [{ domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'], localePrefix: 'never' }] };
  assert.equal(switchLocaleHref('https://example.com/app/shared', 'ru', never), 'https://example.com/app/ru/shared');
  for (const target of ['https://external.test/app/shared', 'mailto:hello@example.com', '#section', 'https://example.eu/app/shared']) {
    assert.equal(switchLocaleHref(target, 'en', config), target);
  }
  assert.equal(switchLocaleHref('https://example.com/app/shared', 'en', config), 'https://example.com/app/shared', 'single-locale domain needs no signal');
});
