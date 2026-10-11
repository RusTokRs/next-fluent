/**
 * Audit pass 16 — see ENGINEERING_AUDIT_V16.md.
 *
 * V15 ended with a list of scenarios nobody had tried yet instead of a list of
 * uncovered lines: a third-party `Host`, a caching CDN, `basePath` combined
 * with domains, two Next apps behind one reverse proxy. Two of those turned
 * into real defects, and a third (the CDN/`Vary` contract) turned out to be
 * correct as written — which is a result too, and is recorded here so the next
 * pass does not re-open it.
 *
 * The oracle below (V16-04) is the reusable part: every URL the navigation
 * layer hands to a browser must be one the middleware already considers
 * canonical, otherwise a rendered `<Link>` costs a redirect on every click.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';

import { createI18nMiddleware } from '../dist/middleware.js';
import { createNavigation } from '../dist/navigation.js';
import { FluentProvider } from '../dist/client.js';

/**
 * A request shaped like the one Next hands the middleware.
 *
 * `basePath` follows the real contract: Next strips it from `nextUrl.pathname`
 * and exposes it separately, so the two are never both present in `pathname`.
 * Getting that wrong makes every basePath assertion here meaningless, so it is
 * modelled once, here.
 */
function request(path, { host = 'example.com', headers = {}, cookies = {}, origin = 'https://backend.internal:3000', basePath } = {}) {
  const url = new URL(path, origin);
  const nextUrl = { pathname: url.pathname, search: url.search };
  if (basePath !== undefined) nextUrl.basePath = basePath;
  const jar = new Map(Object.entries(cookies));
  return {
    url: url.toString(),
    nextUrl,
    headers: new Headers({ host, ...headers }),
    cookies: { get: (name) => (jar.has(name) ? { value: jar.get(name) } : undefined) },
  };
}

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
};

// ---------------------------------------------------------------------------
// V16-01: a client could pick the host that `trustedHosts` then validates
// ---------------------------------------------------------------------------

test('V16-01: trustedHosts is not switchable off with an x-forwarded-host header', async () => {
  const mw = createI18nMiddleware({
    ...routing,
    trustedHosts: ['example.com', 'shop.example.com'],
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
      { domain: 'shop.example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
    ],
  });

  // The header the request actually arrived for is what the allow-list is about.
  for (const spoofed of ['example.com', 'shop.example.com']) {
    const response = await mw(request('/about', {
      host: 'evil.com',
      headers: { 'x-forwarded-host': spoofed, 'accept-language': 'ru' },
    }));
    assert.equal(response.status, 421, `Host: evil.com + x-forwarded-host: ${spoofed} must stay rejected`);
    assert.equal(response.headers.get('location'), null, 'a rejected host must not receive a redirect');
  }

  // ...and the site still answers for its own host.
  const own = await mw(request('/about', { host: 'example.com', headers: { 'accept-language': 'ru' } }));
  assert.equal(own.status, 307);
  assert.equal(own.headers.get('location'), 'https://example.com/ru/about');
});

test('V16-01: the proxy case the domain branch exists for keeps working', async () => {
  const config = {
    ...routing,
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
      { domain: 'shop.example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
    ],
  };

  // Without `trustedHosts` there is no allow-list to defeat, and a proxy that
  // forwards the public host without rewriting `Host` must still be followed.
  const proxied = await createI18nMiddleware(config)(request('/ru/about', {
    host: '127.0.0.1:3000',
    headers: { 'x-forwarded-host': 'example.com' },
  }));
  assert.equal(proxied.status, 200);
  assert.equal(proxied.headers.get('x-next-locale'), 'ru');

  // With `trustedHosts`, the forwarded host is followed when the host the
  // request arrived for is itself on the list — that is a real proxy.
  const trusted = await createI18nMiddleware({ ...config, trustedHosts: ['example.com'] })(request('/ru/about', {
    host: 'example.com',
    headers: { 'x-forwarded-host': 'example.com' },
  }));
  assert.equal(trusted.status, 200);
  assert.equal(trusted.headers.get('x-next-locale'), 'ru');

  // A forwarded host that is not a configured domain is ignored, as before.
  const foreign = await createI18nMiddleware(config)(request('/ru/about', {
    host: 'example.com',
    headers: { 'x-forwarded-host': 'evil.com' },
  }));
  assert.equal(foreign.status, 200);
});

// ---------------------------------------------------------------------------
// V16-02: `Host: example.com:443` is the same authority, and was rejected
// ---------------------------------------------------------------------------

test('V16-02: the scheme default port in Host is not read as a foreign host', async () => {
  const mw = createI18nMiddleware({ ...routing, trustedHosts: ['example.com'] });

  // https drops :443, http drops :80 — both spellings name the trusted host.
  const secure = await mw(request('/ru/about', { host: 'example.com:443', origin: 'https://backend.internal:3000' }));
  assert.equal(secure.status, 200);
  assert.equal(secure.headers.get('x-next-locale'), 'ru');

  const plain = await mw(request('/ru/about', { host: 'example.com:80', origin: 'http://backend.internal:3000' }));
  assert.equal(plain.status, 200);

  // ...and the public URLs are still built from that host, not the internal one.
  const redirect = await mw(request('/about', { host: 'example.com:443', origin: 'https://backend.internal:3000' }));
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'https://example.com/en/about');

  const alternate = await mw(request('/ru/about', { host: 'example.com:443', origin: 'https://backend.internal:3000' }));
  assert.match(alternate.headers.get('link') ?? '', /<https:\/\/example\.com\/ru\/about>/);
});

test('V16-02: a smuggled or foreign authority is still refused', async () => {
  const mw = createI18nMiddleware({ ...routing, trustedHosts: ['example.com'] });

  // The allow-list matches on the hostname; a port is not part of the name, so
  // `example.com:8443` behaves exactly like `example.com:80` did before.
  assert.equal((await mw(request('/ru/about', { host: 'example.com:8443' }))).status, 200);
  assert.equal((await mw(request('/ru/about', {
    host: 'example.com:80', origin: 'https://backend.internal:3000',
  }))).status, 200);
  // ...but the default-port spelling must not be the only one that gets there.
  assert.equal((await mw(request('/ru/about', {
    host: 'example.com:443', origin: 'https://backend.internal:3000',
  }))).status, 200);

  // Malformed, userinfo-bearing and foreign Host values stay refused.
  for (const host of ['example.com:443:80', 'example.com@evil.com', 'evil.com', 'example.com.evil.com']) {
    assert.equal((await mw(request('/ru/about', { host }))).status, 421, `Host: ${host} must be rejected`);
  }
});

// ---------------------------------------------------------------------------
// V16-03: prefetch dropped every same-origin target outside 'always'
// ---------------------------------------------------------------------------

function routerFor(config, providerLocale, calls) {
  const nav = createNavigation(config);
  let router;
  function Probe() { router = nav.useRouter(); return null; }
  const nextRouter = Object.fromEntries(
    ['push', 'replace', 'prefetch'].map((name) => [name, (...args) => calls.push([name, ...args])])
  );
  renderToStaticMarkup(
    React.createElement(FluentProvider, { locale: providerLocale, messages: 'x = X' },
      React.createElement(AppRouterContext.Provider, { value: nextRouter }, React.createElement(Probe)))
  );
  return router;
}

test('V16-03: a locale switch prefetches its own URL on a single-domain site', () => {
  const expected = { 'as-needed': '/ru/about', always: '/ru/about', never: '/about' };
  for (const localePrefix of Object.keys(expected)) {
    const calls = [];
    routerFor({ ...routing, localePrefix }, 'en', calls).prefetch('/about', { locale: 'ru' });
    assert.deepEqual(calls, [['prefetch', expected[localePrefix]]], `localePrefix: ${localePrefix}`);
  }

  // Localized slugs resolve too — that is the URL the switcher navigates to.
  const calls = [];
  const localized = { ...routing, localePrefix: 'as-needed', pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } } };
  routerFor(localized, 'en', calls).prefetch('/about', { locale: 'ru' });
  assert.deepEqual(calls, [['prefetch', '/ru/o-nas']]);
});

test('V16-03: a cross-domain target is still skipped, because it cannot be prefetched', () => {
  const config = {
    ...routing,
    locales: ['en', 'ru', 'de'],
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
      { domain: 'shop.example.com', defaultLocale: 'de', locales: ['de'], localePrefix: 'as-needed' },
    ],
  };

  // 'de' is only served on the second domain, whose prefix mode is not
  // 'always' — the case the skip was written for, and it still skips.
  const crossDomain = [];
  routerFor(config, 'en', crossDomain).prefetch('/about', { locale: 'de' });
  assert.deepEqual(crossDomain, [], 'a target on another domain must not be prefetched');

  // 'ru' stays on the first domain, which keeps the global 'always' mode, so
  // its prefixed URL is prefetched exactly as before.
  const sameDomain = [];
  routerFor(config, 'en', sameDomain).prefetch('/about', { locale: 'ru' });
  assert.deepEqual(sameDomain, [['prefetch', 'https://example.com/ru/about']]);
});

// ---------------------------------------------------------------------------
// V16-04: the invariant behind all three — nav and middleware must agree
// ---------------------------------------------------------------------------

test('V16-04: every URL navigation produces is already canonical for the middleware', async () => {
  const pathnames = {
    '/about': { en: '/about-us', ru: '/o-nas' },
    '/docs': '/docs',
    '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]' },
    '/blog/[[...slug]]': { en: '/blog/[[...slug]]', ru: '/blog/[[...slug]]' },
  };
  const configs = [
    { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always', pathnames },
    { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed', pathnames },
    { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never', pathnames },
    { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always', pathnames, basePath: '/app' },
    { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed', pathnames, basePath: '/app' },
    {
      locales: ['en', 'ru'],
      defaultLocale: 'en',
      localePrefix: { mode: 'as-needed', prefixes: { en: '/english', ru: '/rus' } },
      pathnames,
    },
    {
      locales: ['en', 'ru', 'de'],
      defaultLocale: 'en',
      localePrefix: 'always',
      pathnames,
      domains: [
        { domain: 'en.test', defaultLocale: 'en', locales: ['en', 'ru'] },
        { domain: 'de.test', defaultLocale: 'de', locales: ['de'] },
      ],
    },
    {
      locales: ['en', 'ru'],
      defaultLocale: 'en',
      localePrefix: 'always',
      basePath: '/app',
      pathnames,
      domains: [
        { domain: 'en.test', defaultLocale: 'en', locales: ['en', 'ru'], localePrefix: 'as-needed' },
        { domain: 'ru.test', defaultLocale: 'ru', locales: ['en', 'ru'], localePrefix: 'never' },
      ],
    },
  ];
  const routes = ['/', '/about', '/docs', '/products/42', '/blog/a/b'];

  for (const config of configs) {
    const nav = createNavigation(config);
    const mw = createI18nMiddleware(config);
    for (const locale of config.locales) {
      for (const href of routes) {
        const target = nav.getPathname({ href, locale });
        const url = new URL(target, 'https://origin.invalid');
        let pathname = url.pathname;
        if (config.basePath && (pathname === config.basePath || pathname.startsWith(`${config.basePath}/`))) {
          pathname = pathname.slice(config.basePath.length) || '/';
        }
        const response = await mw(request(pathname + url.search, {
          host: url.host,
          basePath: config.basePath,
        }));
        assert.equal(response.status, 200,
          `${JSON.stringify(config.localePrefix)} / basePath=${config.basePath ?? '-'} ` +
          `${locale} ${href} -> ${target} answered ${response.status} ${response.headers.get('location')}`);
      }
    }
  }
});