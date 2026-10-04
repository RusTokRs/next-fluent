import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createI18nMiddleware } from '../dist/middleware.js';
import { buildAlternateLinksHeader } from '../dist/alternate-links.js';
import {
  absoluteUrlFromObject,
  formatUrlObject,
  resolveLocalizedPathname,
} from '../dist/nav-url.js';
import { localeFromCatalogName, readCatalogsByLocale } from '../dist/catalog-io.js';
import { getCachedFluentBundle, clearBundleCache } from '../dist/cache.js';
import { FluentProvider, useTranslations } from '../dist/client.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  pathnames: {
    '/about': { en: '/about-us', ru: '/o-nas' },
    '/docs/[id]': { en: '/docs/[id]', ru: '/dokumenty/[id]' },
  },
};

function mockRequest(pathname, headers = {}, cookie) {
  const url = new URL(pathname, 'http://localhost:3000');
  const all = { host: 'localhost:3000', ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: { get: (name) => (name === 'NEXT_LOCALE' && cookie ? { value: cookie } : undefined) },
    headers: {
      get: (name) => all[name.toLowerCase()] ?? null,
      forEach: (callback) => Object.entries(all).forEach(([key, value]) => callback(value, key)),
    },
  };
}

// ---------------------------------------------------------------------------
// V4-06: detection and slug canonicalization happen in one redirect
// ---------------------------------------------------------------------------

test('an Accept-Language match lands on the canonical slug in one hop', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(response.status, 307);
  // Two hops (/ru/about-us then /ru/o-nas) made every detected visitor pay an
  // extra round trip and exposed a non-canonical URL.
  assert.equal(new URL(response.headers.get('location')).pathname, '/ru/o-nas');
});

test('the canonical slug of the detected locale is served directly', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/ru/o-nas'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

test('detection still does not run when localeDetection is off', async () => {
  const mw = createI18nMiddleware({ ...routing, localeDetection: false });
  const response = await mw(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-next-locale'), 'en');
});

// ---------------------------------------------------------------------------
// V4-08: responses decided by cookie/Accept-Language vary on both
// ---------------------------------------------------------------------------

test('detection-derived responses carry Vary, URL-derived ones do not', async () => {
  const mw = createI18nMiddleware(routing);

  const detected = await mw(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(detected.headers.get('vary'), 'Accept-Language, Cookie');

  const root = await mw(mockRequest('/', { 'accept-language': 'ru' }));
  assert.equal(root.headers.get('vary'), 'Accept-Language, Cookie');

  // `/ru/o-nas` spells its locale in the URL: caching it per language would be
  // pointless, and the header would needlessly fragment CDN keys.
  const prefixed = await mw(mockRequest('/ru/o-nas'));
  assert.equal(prefixed.headers.get('vary'), null);

  const noDetection = createI18nMiddleware({ ...routing, localeDetection: false });
  const staticResponse = await noDetection(mockRequest('/', { 'accept-language': 'ru' }));
  assert.equal(staticResponse.headers.get('vary'), null);
});

// ---------------------------------------------------------------------------
// V4-07: catalog file names are locales, not namespace labels
// ---------------------------------------------------------------------------

function withCatalogDir(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v5-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('localeFromCatalogName separates a namespace suffix from the locale', () => {
  assert.equal(localeFromCatalogName('en'), 'en');
  assert.equal(localeFromCatalogName('pt_BR'), 'pt-BR');
  assert.equal(localeFromCatalogName('en-app'), 'en');
  assert.equal(localeFromCatalogName('en-US-app'), 'en-US');
  assert.equal(localeFromCatalogName('ru.docs'), 'ru');
  // Not locale-like at all: keep the raw stem so the file is still reported.
  assert.equal(localeFromCatalogName('__proto__'), '__proto__');
});

test('a flat namespaced catalog joins its locale instead of becoming one', () => {
  withCatalogDir(
    {
      'en.ftl': 'hello = Hello\n',
      'ru.ftl': 'hello = Privet\n',
      'en-app.json': '{"app":{"title":"App"}}\n',
    },
    (dir) => {
      const catalogs = readCatalogsByLocale(dir);
      assert.deepEqual(Object.keys(catalogs), ['en', 'ru']);
      assert.equal(catalogs.en.length, 2, 'the namespace file must be merged into en');
      assert.equal(catalogs.ru.length, 1);
    }
  );
});

test('directory-based locales are canonicalized too', () => {
  withCatalogDir(
    {
      'en/app.ftl': 'a = A\n',
      'pt_BR/app.ftl': 'a = A pt\n',
    },
    (dir) => {
      assert.deepEqual(Object.keys(readCatalogsByLocale(dir)), ['en', 'pt-BR']);
    }
  );
});

test('check compares real locales instead of the namespace file', () => {
  const run = (files, args = []) =>
    withCatalogDir(files, (dir) =>
      spawnSync(process.execPath, [path.join(ROOT, 'bin', 'next-fluent.mjs'), 'check', '--input', dir, ...args], {
        encoding: 'utf8',
      })
    );

  const balanced = run({
    'en.ftl': 'hello = Hello\n',
    'ru.ftl': 'hello = Privet\n',
    'en-app.json': '{"app":{"title":"App"}}\n',
    'ru-app.json': '{"app":{"title":"Prilozhenie"}}\n',
  });
  assert.equal(balanced.status, 0, balanced.stdout + balanced.stderr);
  assert.match(balanced.stdout, /Checked 2 catalog\(s\) against "en"/);
  assert.doesNotMatch(balanced.stdout, /en-app/);

  // A locale that really is missing the namespace is still reported — that is
  // a true finding, not an artifact of the file name.
  const unbalanced = run({
    'en.ftl': 'hello = Hello\n',
    'ru.ftl': 'hello = Privet\n',
    'en-app.json': '{"app":{"title":"App"}}\n',
  });
  assert.equal(unbalanced.status, 1, unbalanced.stdout + unbalanced.stderr);
  assert.match(unbalanced.stdout, /"app-title" is missing/);
  assert.doesNotMatch(unbalanced.stdout, /en-app/);
});

test('--reference matches a canonicalized file name', () => {
  const result = withCatalogDir(
    { 'en.ftl': 'hello = Hello\n', 'pt_BR.ftl': 'hello = Ola\n' },
    (dir) =>
      spawnSync(
        process.execPath,
        [path.join(ROOT, 'bin', 'next-fluent.mjs'), 'check', '--input', dir, '--reference', 'pt-BR'],
        { encoding: 'utf8' }
      )
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /against "pt-BR"/);
});

// ---------------------------------------------------------------------------
// V4-09 / V4-10: production cookie hardening and the development warning
// ---------------------------------------------------------------------------

const middlewareProbe = `
import { createI18nMiddleware } from ${JSON.stringify(path.join(ROOT, 'dist', 'middleware.js'))};
const mw = createI18nMiddleware({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed' });
const request = (pathname) => ({
  url: 'http://localhost:3000' + pathname,
  nextUrl: { pathname, search: '' },
  cookies: { get: () => undefined },
  headers: { get: (name) => (name === 'host' ? 'localhost:3000' : null), forEach: () => {} },
});
const cookie = await mw(request('/ru/x'));
const redirect = await mw(request('/en/y'));
console.log(JSON.stringify({
  cookie: cookie.headers.getSetCookie?.().join(' | ') ?? '',
  status: redirect.status,
}));
`;

function runMiddlewareProbe(env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', middlewareProbe], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: env },
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.trim().split('\n').pop();
  return { ...JSON.parse(line), stderr: result.stderr };
}

test('the locale cookie is Secure in production and overridable', () => {
  const production = runMiddlewareProbe('production');
  assert.match(production.cookie, /NEXT_LOCALE=ru/);
  assert.match(production.cookie, /Secure/);

  const development = runMiddlewareProbe('development');
  assert.doesNotMatch(development.cookie, /Secure/);
});

test('the missing-trustedHosts warning is development-only and shown once', () => {
  const development = runMiddlewareProbe('development');
  const warnings = development.stderr.split('[next-fluent] trustedHosts').length - 1;
  assert.equal(warnings, 1, development.stderr);

  const production = runMiddlewareProbe('production');
  assert.doesNotMatch(production.stderr, /trustedHosts/);
});

test('a configured trustedHosts list silences the warning', () => {
  const script = middlewareProbe.replace(
    "{ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed' }",
    "{ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed', trustedHosts: ['localhost'] }"
  );
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /trustedHosts is not configured/);
});

// ---------------------------------------------------------------------------
// V4-12: URL objects keep the origin they were given
// ---------------------------------------------------------------------------

test('formatUrlObject reads a relative href instead of falling back to /', () => {
  assert.deepEqual(formatUrlObject({ href: '/docs', query: { a: 1 } }), {
    pathname: '/docs',
    search: '?a=1',
    hash: '',
  });
  assert.deepEqual(formatUrlObject({ href: '/docs#top' }), {
    pathname: '/docs',
    search: '',
    hash: '#top',
  });
});

test('absolute URL objects are honored, not silently rewritten to the origin', () => {
  assert.equal(
    absoluteUrlFromObject({ protocol: 'https', hostname: 'example.com', pathname: '/docs' }),
    'https://example.com/docs'
  );
  assert.equal(
    resolveLocalizedPathname(
      { href: { protocol: 'https', hostname: 'example.com', pathname: '/docs' }, locale: 'ru' },
      routing
    ),
    'https://example.com/docs'
  );
  // Same-origin absolute hrefs keep behaving like absolute strings: external.
  assert.equal(
    resolveLocalizedPathname({ href: { href: 'https://example.com/docs' } }, routing),
    'https://example.com/docs'
  );
});

test('hostile URL objects are rejected instead of leaking a scheme', () => {
  assert.throws(
    () => resolveLocalizedPathname({ href: { protocol: 'javascript', host: 'x', pathname: '/y' } }, routing),
    /Unsupported URL object protocol/
  );
  assert.throws(
    () => resolveLocalizedPathname({ href: { hostname: 'evil.example/x', pathname: '/y' } }, routing),
    /host must not contain/
  );
});

// ---------------------------------------------------------------------------
// V4-13: a reused functions object is parsed once
// ---------------------------------------------------------------------------

test('bundles built with the same custom functions object are reused', () => {
  const source = 'count = { $n } items';
  const functions = { upper: (value) => String(value).toUpperCase() };

  const first = getCachedFluentBundle('en', source, { functions });
  const second = getCachedFluentBundle('en', source, { functions });
  assert.equal(second, first, 'the same functions object must reuse its bundle');

  const other = getCachedFluentBundle('en', source, { functions: { upper: functions.upper } });
  assert.notEqual(other, first, 'a new functions object must not share the cached bundle');

  clearBundleCache();
  assert.notEqual(
    getCachedFluentBundle('en', source, { functions }),
    first,
    'clearBundleCache() must invalidate per-functions caches too'
  );
});

test('FluentProvider renders with an inline functions object', () => {
  const functions = { upper: (value) => String(value).toUpperCase() };

  function Probe() {
    const t = useTranslations();
    return React.createElement('span', null, t('label'));
  }

  const html = renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale: 'en', messages: 'label = Beta\n', functions },
      React.createElement(Probe)
    )
  );
  assert.equal(html, '<span>Beta</span>');
});

// ---------------------------------------------------------------------------
// V4-14: alternate links drop route parameters from the query
// ---------------------------------------------------------------------------

test('alternate links do not duplicate a parameter the pathname consumed', () => {
  const header = buildAlternateLinksHeader({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    pathname: '/dokumenty/7',
    search: '?id=7&q=x',
    pathnames: routing.pathnames,
    origin: 'http://localhost:3000',
  });

  assert.ok(header, 'expected an alternate links header');
  assert.doesNotMatch(header, /id=7/);
  assert.match(header, /<http:\/\/localhost:3000\/docs\/7\?q=x>; rel="alternate"; hreflang="en"/);
  assert.match(header, /<http:\/\/localhost:3000\/ru\/dokumenty\/7\?q=x>; rel="alternate"; hreflang="ru"/);
  assert.match(header, /hreflang="x-default"/);
});

test('unrelated query parameters survive in alternate links', () => {
  const header = buildAlternateLinksHeader({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    pathname: '/o-nas',
    search: '?utm_source=x',
    pathnames: routing.pathnames,
    origin: 'http://localhost:3000',
  });
  assert.match(header, /\?utm_source=x/);
});

test('the dist freshness gate reports new files, not only modified ones', () => {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-dist-gate-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.copyFileSync(
      path.join(root, 'scripts/check-dist.mjs'),
      path.join(dir, 'scripts/check-dist.mjs')
    );
    const run = () =>
      spawnSync(process.execPath, ['scripts/check-dist.mjs'], { cwd: dir, encoding: 'utf8' });

    const git = (args) =>
      spawnSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
      });

    git(['init']);
    fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'export {};\n');
    // A build output that no commit mentions is untracked, and `git diff` alone
    // would silently accept it.
    assert.equal(run().status, 1, 'an untracked dist file must fail the gate');

    git(['add', '-A']);
    git(['commit', '-m', 'build']);
    assert.equal(run().status, 0, 'a committed dist tree must pass the gate');

    fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'export default 1;\n');
    assert.equal(run().status, 1, 'a stale dist file must fail the gate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
