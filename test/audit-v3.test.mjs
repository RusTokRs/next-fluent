import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFluentBundle, createTranslator } from '../dist/bundle.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { defineRouting } from '../dist/routing.js';
import { hasLocale } from '../dist/utils.js';
import { createFormatter } from '../dist/formatter.js';
import { createI18n } from '../dist/factory.js';
import { FluentErrorCode } from '../dist/errors.js';
import { FluentProvider, useMessages, useTranslations } from '../dist/client.js';
import { buildAlternateLinksHeader } from '../dist/alternate-links.js';

const stripBidiIsolates = (value) => value.replace(/[\u2068\u2069]/g, '');
const silent = { onError: () => {} };

// ---------------------------------------------------------------------------
// V3-01: boolean/bigint arguments must not be dropped
// ---------------------------------------------------------------------------

test('V3-01: boolean and bigint arguments reach the message', () => {
  const bundle = createFluentBundle('en', 'flag = Admin: { $isAdmin }\nbig = Total: { $total }');
  const t = createTranslator(bundle, silent);

  assert.equal(stripBidiIsolates(t('flag', { isAdmin: true })), 'Admin: true');
  assert.equal(stripBidiIsolates(t('flag', { isAdmin: false })), 'Admin: false');
  assert.equal(stripBidiIsolates(t('big', { total: 10n })), 'Total: 10');
});

test('V3-01: unsupported arguments are reported instead of silently dropped', () => {
  const bundle = createFluentBundle('en', 'greet = Hello { $user }!');
  const seen = [];
  const t = createTranslator(bundle, { onError: (error) => seen.push(error) });

  assert.equal(t('greet', { user: { not: 'a fluent type' } }), 'greet');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, FluentErrorCode.INVALID_ARGUMENT);
  assert.deepEqual(seen[0].cause.unsupportedArguments, ['user']);
});

// ---------------------------------------------------------------------------
// V3-10: onError / getMessageFallback
// ---------------------------------------------------------------------------

test('V3-10: missing messages are reported and the fallback is customizable', () => {
  const bundle = createFluentBundle('en', 'known = Yes');
  const seen = [];
  const t = createTranslator(bundle, {
    onError: (error) => seen.push(error),
    getMessageFallback: ({ namespace, key, error }) =>
      `${error.code}:${namespace ? `${namespace}.` : ''}${key}`,
  });

  assert.equal(t('missing'), 'MISSING_MESSAGE:missing');
  assert.equal(seen[0].code, FluentErrorCode.MISSING_MESSAGE);
  assert.equal(t('known'), 'Yes');
  assert.equal(seen.length, 1, 'successful lookups must not report');
});

test('V3-10: a throwing error handler cannot break rendering', () => {
  const bundle = createFluentBundle('en', 'known = Yes');
  const t = createTranslator(bundle, {
    onError: () => {
      throw new Error('logger is down');
    },
    getMessageFallback: () => {
      throw new Error('fallback is down');
    },
  });

  assert.equal(t('missing'), 'missing');
  assert.equal(t('known'), 'Yes');
});

test('V3-10: onError/getMessageFallback flow through the request config', async () => {
  const server = await import('../dist/server.js');
  const seen = [];
  server.setRequestConfig(() => ({
    locale: 'en',
    messages: 'present = Here',
    onError: (error) => seen.push(error.code),
    getMessageFallback: ({ key }) => `<${key}>`,
  }));

  const t = await server.forLocale('en');
  assert.equal(t('present'), 'Here');
  assert.equal(t('absent'), '<absent>');
  assert.deepEqual(seen, [FluentErrorCode.MISSING_MESSAGE]);
  server.setRequestConfig(() => ({ locale: 'en', messages: '' }));
});

// ---------------------------------------------------------------------------
// V3-09: bidi isolates can be disabled
// ---------------------------------------------------------------------------

test('V3-09: useIsolating:false keeps placeables free of bidi isolates', async () => {
  const server = await import('../dist/server.js');
  const messages = 'title = Dashboard { $count }';

  const isolated = await server.forLocale('en', { messages });
  assert.notEqual(stripBidiIsolates(isolated('title', { count: 3 })), isolated('title', { count: 3 }));

  const plain = await server.forLocale('en', { messages, useIsolating: false });
  assert.equal(plain('title', { count: 3 }), 'Dashboard 3');
});

// ---------------------------------------------------------------------------
// V3-02: the internal rewrite signal cannot be spoofed
// ---------------------------------------------------------------------------

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
};

function mockRequest(path, headers = {}, cookie) {
  const url = new URL(path, 'http://localhost:3000');
  const all = { host: 'localhost:3000', ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: { get: (name) => (name === 'NEXT_LOCALE' && cookie ? { value: cookie } : undefined) },
    headers: {
      get: (name) => all[name.toLowerCase()] ?? null,
      forEach: (cb) => Object.entries(all).forEach(([key, value]) => cb(value, key)),
    },
  };
}

test('V3-02: a client-supplied rewrite header cannot skip canonicalization', async () => {
  const mw = createI18nMiddleware(routing);
  const spoofed = await mw(
    mockRequest('/ru/o-nas', { 'x-next-fluent-rewrite': '/ru/o-nas' })
  );
  assert.equal(
    new URL(spoofed.headers.get('x-middleware-rewrite')).pathname,
    '/ru/about',
    'spoofed header must not disable the internal rewrite'
  );

  const alwaysMw = createI18nMiddleware({ ...routing, localePrefix: 'always' });
  const always = await alwaysMw(
    mockRequest('/ru/o-nas', { 'x-next-fluent-rewrite': '/ru/o-nas' })
  );
  assert.equal(new URL(always.headers.get('x-middleware-rewrite')).pathname, '/ru/about');
});

test('V3-02: the signal still prevents the as-needed default-locale redirect loop', async () => {
  const mw = createI18nMiddleware(routing);
  // Second pass Next.js performs after rewriting /about-us -> /en/about.
  const secondPass = await mw(
    mockRequest('/en/about', { 'x-next-fluent-rewrite': '/en/about' })
  );
  assert.equal(secondPass.headers.get('x-middleware-next'), '1');
  assert.equal(secondPass.headers.get('location'), null);
  assert.equal(secondPass.headers.get('x-next-locale'), 'en');
});

test('V3-02: the client-supplied signal header is never forwarded to the app', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(
    mockRequest('/ru/o-nas', { 'x-next-fluent-rewrite': '/ru/o-nas' })
  );
  const forwarded = response.request.headers;
  assert.equal(forwarded.get('x-next-fluent-rewrite'), '/ru/about');
});

// ---------------------------------------------------------------------------
// V3-06: slugs of another locale are normalized instead of 404-ing
// ---------------------------------------------------------------------------

test('V3-06: a slug belonging to another locale redirects to the canonical one', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/ru/about-us'));

  // The route still resolves, but through the slug this locale actually
  // defines, so there is exactly one URL per page.
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')).pathname, '/ru/o-nas');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
});

test('V3-06b: the canonical slug still resolves to the internal route', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/ru/o-nas'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(
    new URL(response.headers.get('x-middleware-rewrite')).pathname,
    '/ru/about'
  );
});

test('V3-06c: the canonical redirect does not loop on the rewritten pathname', async () => {
  const mw = createI18nMiddleware(routing);
  // Next.js runs the middleware again for the internal pathname the rewrite
  // points at. Without the signal header that pass would redirect back.
  const response = await mw(
    mockRequest('/ru/about', { 'x-next-fluent-rewrite': '/ru/about' })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

// ---------------------------------------------------------------------------
// V3-03: configuration validation
// ---------------------------------------------------------------------------

test('V3-03: invalid localePrefix, cookieName and headerName are rejected', () => {
  assert.throws(
    () => defineRouting({ locales: ['en'], defaultLocale: 'en', localePrefix: 'as-neede' }),
    /localePrefix/
  );
  assert.throws(
    () => defineRouting({ locales: ['en'], defaultLocale: 'en', cookieName: 'bad\r\nname' }),
    /cookieName/
  );
  assert.throws(
    () => defineRouting({ locales: ['en'], defaultLocale: 'en', headerName: 'x locale' }),
    /headerName/
  );
  assert.throws(
    () => createI18nMiddleware({ locales: ['en'], defaultLocale: 'en', localePrefix: 'ALWAYS' }),
    /localePrefix/
  );
});

// ---------------------------------------------------------------------------
// V3-04/V3-05: locale cookie behaviour
// ---------------------------------------------------------------------------

test('V3-04: the locale cookie is only written when it changes on document requests', async () => {
  const mw = createI18nMiddleware(routing);

  const first = await mw(mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'document' }));
  assert.equal(first.headers.getSetCookie().length, 1);

  const unchanged = await mw(
    mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'document' }, 'ru')
  );
  assert.deepEqual(unchanged.headers.getSetCookie(), [], 'unchanged locale must stay cacheable');

  const subresource = await mw(mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'image' }));
  assert.deepEqual(subresource.headers.getSetCookie(), []);

  const switched = await mw(
    mockRequest('/en/about-us', { 'sec-fetch-dest': 'document' }, 'ru')
  );
  assert.ok(switched.headers.getSetCookie().join().includes('NEXT_LOCALE=en'));
});

test('V3-05: the locale cookie can be disabled and customized', async () => {
  const disabled = await createI18nMiddleware({ ...routing, localeCookie: false })(
    mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'document' })
  );
  assert.deepEqual(disabled.headers.getSetCookie(), []);

  const custom = await createI18nMiddleware({
    ...routing,
    localeCookie: { name: 'lang', secure: true, sameSite: 'strict', maxAge: 60, path: '/app' },
  })(mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'document' }));
  const cookie = custom.headers.getSetCookie().join();
  assert.ok(cookie.startsWith('lang=ru;'), cookie);
  assert.ok(cookie.includes('Secure') && cookie.includes('SameSite=strict') && cookie.includes('Max-Age=60'), cookie);
});

test('V3-04: localeDetection:false ignores cookie and Accept-Language', async () => {
  const mw = createI18nMiddleware({ ...routing, localeDetection: false });
  const response = await mw(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(response.headers.get('x-next-locale'), 'en');
  assert.equal(response.headers.get('location'), null);

  const detecting = createI18nMiddleware(routing);
  const detected = await detecting(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(new URL(detected.headers.get('location')).pathname, '/ru/about-us');
});

// ---------------------------------------------------------------------------
// V3-18: hreflang alternate links
// ---------------------------------------------------------------------------

test('V3-18: middleware emits hreflang alternates including x-default', async () => {
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/ru/o-nas'));
  const link = response.headers.get('link');
  assert.ok(link.includes('<http://localhost:3000/about-us>; rel="alternate"; hreflang="en"'), link);
  assert.ok(link.includes('<http://localhost:3000/ru/o-nas>; rel="alternate"; hreflang="ru"'), link);
  assert.ok(link.includes('hreflang="x-default"'), link);
});

test('V3-18: alternates can be disabled and are skipped for localePrefix "never"', async () => {
  const disabled = await createI18nMiddleware({ ...routing, alternateLinks: false })(
    mockRequest('/ru/o-nas')
  );
  assert.equal(disabled.headers.get('link'), null);

  const never = await createI18nMiddleware({ ...routing, localePrefix: 'never' })(
    mockRequest('/o-nas')
  );
  assert.equal(never.headers.get('link'), null);
});

test('V3-18: alternates keep dynamic route parameters and honor domains', () => {
  const header = buildAlternateLinksHeader({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    pathname: '/tovary/42',
    pathnames: { '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]' } },
    origin: 'https://example.com',
  });
  assert.ok(header.includes('https://example.com/products/42'), header);
  assert.ok(header.includes('https://example.com/ru/tovary/42'), header);

  const withDomains = buildAlternateLinksHeader({
    locales: ['en', 'de'],
    defaultLocale: 'en',
    localePrefix: 'always',
    pathname: '/about',
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en'] },
      { domain: 'example.de', defaultLocale: 'de', locales: ['de'] },
    ],
    origin: 'https://example.com',
  });
  // localePrefix 'always' keeps the prefix even on a domain's default locale.
  assert.ok(withDomains.includes('<https://example.com/en/about>; rel="alternate"; hreflang="en"'), withDomains);
  assert.ok(withDomains.includes('<https://example.de/de/about>; rel="alternate"; hreflang="de"'), withDomains);
});

// ---------------------------------------------------------------------------
// V3-13/V3-14: hasLocale, useMessages, client-side error handling
// ---------------------------------------------------------------------------

test('V3-13: hasLocale validates against canonical locale identities', () => {
  assert.equal(hasLocale(['en', 'pt-BR'], 'pt-br'), true);
  assert.equal(hasLocale(['en', 'pt-BR'], 'pt_BR'), true);
  assert.equal(hasLocale(['en', 'pt-BR'], 'fr'), false);
  assert.equal(hasLocale(['en'], undefined), false);
});

test('V3-14: useMessages and client-side onError/getMessageFallback', () => {
  const messages = 'greet = Hello { $name }';
  const seen = [];

  function Body() {
    const t = useTranslations();
    const raw = useMessages();
    return React.createElement('span', null, `${t('nope')}|${raw === messages}`);
  }

  const html = renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      {
        locale: 'en',
        messages,
        onError: (error) => seen.push(error.code),
        getMessageFallback: ({ key }) => `~${key}~`,
        strictNamespace: true,
      },
      React.createElement(Body)
    )
  );

  assert.ok(html.includes('~nope~'), html);
  assert.ok(html.includes('|true'), html);
  assert.deepEqual(seen, [FluentErrorCode.MISSING_MESSAGE]);
});

// ---------------------------------------------------------------------------
// V3-07/V3-11: formatter presets and factory timeZone
// ---------------------------------------------------------------------------

test('V3-11: named formats resolve through createFormatter', () => {
  const format = createFormatter({
    locale: 'en',
    timeZone: 'UTC',
    formats: {
      dateTime: { short: { dateStyle: 'short' } },
      number: { percent: { style: 'percent' } },
    },
  });

  assert.equal(format.dateTime(new Date('2026-06-01T10:00:00Z'), 'short'), '6/1/26');
  assert.equal(format.number(0.25, 'percent'), '25%');
  assert.equal(format.number(1234.5, { style: 'decimal' }), '1,234.5');
});

test('V3-07: createI18n().getFormatter respects the request timeZone', async () => {
  const server = await import('../dist/server.js');
  server.setRequestConfig(() => ({
    locale: 'en',
    messages: 'x = y',
    timeZone: 'Asia/Tokyo',
  }));
  const runtime = createI18n({ locales: ['en', 'ru'], defaultLocale: 'en' });
  const format = await runtime.getFormatter({ locale: 'en' });
  assert.equal(format.timeZone, 'Asia/Tokyo');
  assert.equal(
    format.dateTime(new Date('2026-06-01T00:00:00Z'), { hour: '2-digit', hour12: false }),
    '09'
  );
  server.setRequestConfig(() => ({ locale: 'en', messages: '' }));
});

// ---------------------------------------------------------------------------
// V3-19: a slug owned by one locale identifies that locale
// ---------------------------------------------------------------------------

test('V3-19: a localized slug serves its own locale without a cookie', async () => {
  // `never` mode carries no locale prefix, so the slug is the only evidence in
  // the URL. Before this, a first visit with no cookie resolved to the default
  // locale and /ru's slug was redirected away — a shared link to /o-nas landed
  // on the English page.
  const mw = createI18nMiddleware({ ...routing, localePrefix: 'never' });

  const russian = await mw(mockRequest('/o-nas'));
  assert.equal(russian.headers.get('x-next-locale'), 'ru');
  assert.equal(russian.headers.get('location'), null);

  // The default locale's own slug is unaffected.
  const english = await mw(mockRequest('/about-us'));
  assert.equal(english.headers.get('x-next-locale'), 'en');
  assert.equal(english.headers.get('location'), null);
});

test('V3-19b: the default locale slug does not override Accept-Language', async () => {
  // The default locale's slug is the generic form every visit can land on, so
  // it must not outrank detection — otherwise an ordinary Russian visitor
  // asking for /about-us would be pinned to English.
  const mw = createI18nMiddleware(routing);
  const response = await mw(mockRequest('/about-us', { 'accept-language': 'ru' }));
  assert.equal(new URL(response.headers.get('location')).pathname, '/ru/about-us');
});

test('V3-19c: an explicit locale cookie outranks the slug', async () => {
  const mw = createI18nMiddleware({ ...routing, localePrefix: 'never' });
  const response = await mw(mockRequest('/o-nas', {}, 'en'));
  assert.equal(response.headers.get('x-next-locale'), 'en');
  assert.equal(new URL(response.headers.get('location')).pathname, '/about-us');
});

// Next.js 16 hands a middleware rewrite to the client router as a redirect,
// where 15 kept it transparent. The router therefore really does request the
// internal rewrite target (`/en/about` for the public `/about-us`), and
// canonicalizing it straight back made every page with a localized slug loop.
test('V3-20: a router fetch of the internal rewrite target is a fixed point', async () => {
  const mw = createI18nMiddleware(routing);
  const res = await mw(mockRequest('/en/about', { 'sec-fetch-dest': 'empty' }, 'en'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('location'), null);
});

test('V3-20b: the same internal path still canonicalizes for a document request', async () => {
  const mw = createI18nMiddleware(routing);
  const res = await mw(mockRequest('/en/about', { 'sec-fetch-dest': 'document' }, 'en'));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get('location')).pathname, '/about-us');
});

// Without the cookie the next prefix-less URL resolves back to the old locale,
// so a client-side locale switch silently undoes itself.
test('V3-21: a locale-changing redirect persists the cookie for router fetches', async () => {
  const mw = createI18nMiddleware(routing);
  const res = await mw(mockRequest('/en/about-us', { 'sec-fetch-dest': 'empty' }, 'ru'));
  assert.equal(res.status, 307);
  assert.match(res.headers.get('set-cookie') ?? '', /NEXT_LOCALE=en/);
});

// The cacheability guard that motivated the document-only restriction.
test('V3-22: a successful router fetch still writes no cookie', async () => {
  const mw = createI18nMiddleware(routing);
  const res = await mw(mockRequest('/about-us', { 'sec-fetch-dest': 'empty' }, 'en'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
});

/**
 * Walks the middleware the way a client would, so a canonicalization cycle
 * becomes a test failure instead of a hung browser.
 *
 * `next16` reproduces the behaviour that exposed the loop: Next.js 16 hands a
 * middleware rewrite to the client router as a redirect, where 15 kept it
 * transparent. Without modelling that, a cycle between a public slug and its
 * internal rewrite target is invisible at this level.
 */
async function followMiddleware(mw, startPath, { cookie, dest, next16 = false, limit = 8 } = {}) {
  const seen = [];
  let path = startPath;
  let currentCookie = cookie;
  for (let hop = 1; hop <= limit; hop += 1) {
    const res = await mw(mockRequest(path, { 'sec-fetch-dest': dest }, currentCookie));
    const applied = /NEXT_LOCALE=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
    if (applied) currentCookie = applied[1];
    const rewrite =
      next16 && dest !== 'document' ? res.headers.get('x-middleware-rewrite') : null;
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    const next = rewrite ?? location;
    seen.push(`${path} -> ${res.status}${next ? ` ${new URL(next).pathname}` : ''}`);
    if (!next) return { hops: hop, path, cookie: currentCookie, seen };
    path = new URL(next).pathname;
  }
  throw new Error(`redirect cycle for ${startPath}: ${seen.join(' | ')}`);
}

const prefixModes = ['as-needed', 'always', 'never'];

for (const mode of prefixModes) {
  const modeRouting = { ...routing, localePrefix: mode };

  // `/en/about-us` is the href a locale switch renders in every mode: a
  // canonical prefixed URL under `as-needed`/`always`, a signal URL in `never`.
  test(`V3-23 (${mode}): a router fetch settles instead of cycling`, async () => {
    const mw = createI18nMiddleware(modeRouting);
    const result = await followMiddleware(mw, '/en/about-us', {
      cookie: 'ru',
      dest: 'empty',
      next16: true,
    });
    assert.ok(result.hops <= 4, `took ${result.hops} hops: ${result.seen.join(' | ')}`);
    // The terminal state is the internal rewrite target, held there as a fixed
    // point — that is what stops the cycle.
    assert.equal(result.path, '/en/about');
    if (mode === 'always') {
      // `/en/about-us` is already canonical, so nothing redirects and no cookie
      // is written. Deliberate: the only way to set one here would be on a 200,
      // and a prefetch of a foreign-locale link would then change the locale.
      assert.equal(result.cookie, 'ru');
    } else {
      assert.equal(result.cookie, 'en', 'the locale switch must persist');
    }
  });

  test(`V3-24 (${mode}): a document navigation settles and persists`, async () => {
    const mw = createI18nMiddleware(modeRouting);
    const result = await followMiddleware(mw, '/en/about-us', {
      cookie: 'ru',
      dest: 'document',
      next16: true,
    });
    assert.ok(result.hops <= 4, `took ${result.hops} hops: ${result.seen.join(' | ')}`);
    assert.equal(result.cookie, 'en');
    // A typed-in URL never ends on the internal path.
    assert.notEqual(result.path, '/en/about');
  });
}

// A prefetch must never move the visitor to another locale, which is why the
// cookie stays restricted to redirects and document navigations.
test('V3-25: a prefetch of a foreign-locale link does not change the cookie', async () => {
  const mw = createI18nMiddleware({ ...routing, localePrefix: 'always' });
  const res = await mw(mockRequest('/ru/o-nas', { 'sec-fetch-dest': 'empty' }, 'en'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
});
