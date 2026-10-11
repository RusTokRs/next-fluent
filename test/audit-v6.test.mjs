import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createI18nMiddleware,
  createFluentBundle,
  createTranslator,
  pseudoLocalizeFtl,
  resolveAcceptLanguage,
  extractMessagesFromFtl,
} from '../dist/index.js';
import { jsonToFluent } from '../dist/catalog.js';
import { pickMessages } from '../dist/pick-messages.js';
import { analyzeUsage } from '../dist/usage.js';
import { generateTypeDeclarations } from '../dist/typegen.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Regression tests for the sixth audit pass — see ENGINEERING_AUDIT_V5.md.
 *
 * Every case here failed (or produced a silently wrong result) before the fix
 * it names; the numbers in the test titles are the finding ids of that report.
 */

// ---------------------------------------------------------------------------
// V5-01 — pickMessages dropped referenced messages
// ---------------------------------------------------------------------------

const catalog = `
-brand-name = Acme
-legal = Legal { -brand-name }
common-greeting = Hello from { -brand-name }
checkout-title = Buy { common-greeting }
checkout-legal = See { -legal }
checkout-own = Own message
other-title = Other
`;

const translatorFor = (ftl) =>
  createTranslator(createFluentBundle('en', ftl, { disableCache: true, useIsolating: false }), {
    onError: () => {},
  });

test('V5-01: a message referenced by the namespace is kept', () => {
  const picked = pickMessages(catalog, 'checkout');
  assert.match(picked, /^common-greeting = Hello from \{ -brand-name \}/m);
  assert.match(picked, /^checkout-title = Buy \{ common-greeting \}/m);
  // Messages of other namespaces stay pruned.
  assert.doesNotMatch(picked, /other-title/);

  const t = translatorFor(picked);
  assert.equal(t('checkout-title'), 'Buy Hello from Acme');
});

test('V5-01: references are followed transitively (message → term → term)', () => {
  const picked = pickMessages(catalog, 'checkout');
  assert.match(picked, /^-brand-name = Acme$/m);
  assert.match(picked, /^-legal = Legal \{ -brand-name \}$/m);

  const t = translatorFor(picked);
  assert.equal(t('checkout-legal'), 'See Legal Acme');
  assert.equal(t('checkout-own'), 'Own message');
});

test('V5-01: a message kept only because it is referenced is emitted once', () => {
  const picked = pickMessages(catalog, 'checkout');
  assert.equal(picked.match(/^common-greeting =/gm).length, 1);
});

test('V5-01: keepTerms:false still keeps referenced messages', () => {
  const picked = pickMessages(catalog, 'checkout', { keepTerms: false });
  assert.doesNotMatch(picked, /^-brand-name =/m);
  assert.match(picked, /^common-greeting =/m);
});

test('V5-01: a self-referencing message does not duplicate itself', () => {
  const picked = pickMessages('ns-a = A { ns-a }\n', 'ns');
  assert.equal(picked.match(/^ns-a =/gm).length, 1);
});

test('V5-01: the pruned catalog keeps the source order of the entries', () => {
  const picked = pickMessages(catalog, 'checkout');
  const order = [...picked.matchAll(/^(?:-)?[a-z-]+ =/gm)].map((match) => match[0]);
  assert.deepEqual(order, [
    '-brand-name =',
    '-legal =',
    'common-greeting =',
    'checkout-title =',
    'checkout-legal =',
    'checkout-own =',
  ]);
});

// ---------------------------------------------------------------------------
// V5-03 — unparsable entries were dropped without a trace
// ---------------------------------------------------------------------------

test('V5-03: pickMessages reports an unparsable entry of the requested namespace', () => {
  const broken = 'ns-good = Fine\nns-bad = Broken { unclosed\nother-bad = Broken { too\n';
  assert.throws(
    () => pickMessages(broken, 'ns'),
    (error) => {
      assert.equal(error.name, 'FluentError');
      assert.match(error.message, /ns-bad = Broken \{ unclosed/);
      assert.doesNotMatch(error.message, /other-bad/, 'junk of other namespaces stays pruned');
      return true;
    }
  );
});

test('V5-03: pseudoLocalizeFtl refuses to emit an incomplete catalog', () => {
  assert.throws(
    () => pseudoLocalizeFtl('good = Fine\nbad = Broken { unclosed\n'),
    /the Fluent parser cannot read/
  );
});

test('V5-03: extractMessagesFromFtl refuses to generate partial declarations', () => {
  assert.throws(
    () => extractMessagesFromFtl('good = Fine\nbad = Broken { unclosed\n'),
    /the Fluent parser cannot read/
  );
});

test('V5-03: a readable catalog is untouched by the new guard', () => {
  assert.equal(jsonToFluent({ ok: 'value' }), 'ok = value\n');
  assert.match(pseudoLocalizeFtl('ok = Fine\n'), /^ok = \[/);
  assert.deepEqual(extractMessagesFromFtl('ok = Fine\n').map((m) => m.id), ['ok']);
});

// ---------------------------------------------------------------------------
// V5-02 — JSON catalogs could declare the same message id twice
// ---------------------------------------------------------------------------

test('V5-02: nested and dashed spellings of one key are rejected', () => {
  assert.throws(
    () => jsonToFluent({ 'nav-home': 'A', nav: { home: 'B' } }),
    (error) => {
      assert.equal(error.name, 'FluentError');
      assert.match(error.message, /both map to the Fluent message id "nav-home"/);
      return true;
    }
  );
});

test('V5-02: two top-level spellings of one key are rejected', () => {
  assert.throws(() => jsonToFluent({ 'a-b': 'A', 'a.b': 'B' }), /both map to the Fluent message id/);
});

test('V5-02: deeper collisions are rejected as well', () => {
  assert.throws(
    () => jsonToFluent({ a: { 'b-c': 'A' }, 'a-b': { c: 'B' } }),
    /both map to the Fluent message id "a-b-c"/
  );
});

test('V5-02: distinct keys and attributes still convert', () => {
  assert.equal(
    jsonToFluent({ nav: { home: 'Home' }, 'login-button': { '': 'Log in', label: 'Login' } }),
    'nav-home = Home\nlogin-button = Log in\n    .label = Login\n'
  );
});

// ---------------------------------------------------------------------------
// V5-04 — `*` re-selected a locale the client refused with q=0
// ---------------------------------------------------------------------------

test('V5-04: a wildcard skips a locale explicitly refused with q=0', () => {
  assert.equal(resolveAcceptLanguage('en;q=0,*', ['en', 'ru'], 'en'), 'ru');
  assert.equal(resolveAcceptLanguage('ru;q=0,*', ['en', 'ru'], 'en'), 'en');
  assert.equal(resolveAcceptLanguage('en;q=0,ru;q=0,*', ['en', 'ru'], 'en'), undefined);
});

test('V5-04: the preferred locale is still honoured when it is not refused', () => {
  assert.equal(resolveAcceptLanguage('*', ['en', 'ru', 'de'], 'de'), 'de');
  assert.equal(resolveAcceptLanguage('ru;q=0,*', ['en', 'ru'], 'ru'), 'en');
});

test('V5-04: q=0 for an unsupported locale changes nothing', () => {
  assert.equal(resolveAcceptLanguage('de;q=0,*', ['en', 'ru'], 'en'), 'en');
  assert.equal(resolveAcceptLanguage('de;q=0', ['en', 'ru'], 'en'), undefined);
});

test('V5-04: the ordinary negotiation path is unchanged', () => {
  assert.equal(resolveAcceptLanguage('ru;q=0.8,en;q=0.9', ['en', 'ru']), 'en');
  assert.equal(resolveAcceptLanguage('ru;q=0.9,en;q=0.9', ['en', 'ru']), 'ru');
  assert.equal(resolveAcceptLanguage('fr-CH, en;q=0.8', ['en', 'ru']), 'en');
});

// ---------------------------------------------------------------------------
// V5-09 — the absolute host spelling was not recognised
// ---------------------------------------------------------------------------

const request = ({ pathname = '/', host = 'example.com', headers = {} }) => ({
  url: `https://${host}${pathname}`,
  nextUrl: { pathname, search: '' },
  cookies: { get: () => undefined },
  headers: {
    get: (name) => {
      const key = name.toLowerCase();
      if (key === 'host') return host;
      return key in headers ? headers[key] : null;
    },
  },
});

test('V5-09: a trailing-dot Host passes the trustedHosts allow-list', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    trustedHosts: ['example.com', '*.example.org'],
  });
  assert.equal((await middleware(request({ host: 'example.com.' }))).status, 200);
  assert.equal((await middleware(request({ host: 'a.example.org.' }))).status, 200);
  assert.equal((await middleware(request({ host: 'evil.test.' }))).status, 421);
});

test('V5-09: domain routing matches the absolute Host spelling', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en'] },
      { domain: 'example.ru', defaultLocale: 'ru', locales: ['ru'] },
    ],
  });
  const foreign = await middleware(request({ pathname: '/ru/docs', host: 'example.com.' }));
  assert.equal(foreign.status, 307);
  assert.equal(foreign.headers.get('location'), 'https://example.ru/docs');
});

// ---------------------------------------------------------------------------
// V5-07/V5-08 — usage analyzer: parse parity and line numbers
// ---------------------------------------------------------------------------

test('V5-07: the usage analyzer reports deep nesting instead of a stack overflow', () => {
  const deep = `a = ${'{'.repeat(4000)}\n`;
  assert.throws(
    () => analyzeUsage({ en: deep }, []),
    /nested too deeply for the FTL parser/
  );
});

test('V5-08: a line continuation inside a template literal keeps line numbers aligned', () => {
  const source = [
    'const t = useTranslations("ns");',
    'const text = `first\\',
    'second`;',
    "t('ns-missing');",
    '',
  ].join('\n');
  const report = analyzeUsage(
    { en: 'ns-present = Ok\n' },
    [{ path: 'app/page.tsx', content: source }]
  );
  const missing = report.issues.find((issue) => issue.kind === 'missing');
  assert.ok(missing, 'the call site is reported');
  assert.equal(missing.line, 4);
});

test('V5-08: an escape that is not a line break still masks as before', () => {
  const source = [
    'const t = useTranslations("ns");',
    'const text = `a\\`b`;',
    "t('ns-missing');",
    '',
  ].join('\n');
  const report = analyzeUsage(
    { en: 'ns-present = Ok\n' },
    [{ path: 'app/page.tsx', content: source }]
  );
  assert.equal(report.issues.find((issue) => issue.kind === 'missing').line, 3);
});

// ---------------------------------------------------------------------------
// V5-09 — an absolute (`example.com.`) Host spelling is still the same host
// ---------------------------------------------------------------------------

test('V5-09: trustedHosts accepts the absolute FQDN spelling', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    trustedHosts: ['example.com', '*.example.org'],
  });
  assert.equal((await middleware(request({ host: 'example.com.' }))).status, 200);
  assert.equal((await middleware(request({ host: 'app.example.org.' }))).status, 200);
  assert.equal((await middleware(request({ host: 'evil.test.' }))).status, 421);
});

test('V5-09: a trailing dot does not change domain routing', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    domains: [
      { domain: 'example.ru', defaultLocale: 'ru', locales: ['ru'] },
      { domain: 'example.com', defaultLocale: 'en', locales: ['en'] },
    ],
    localeDetection: false,
  });
  // The dotted spelling is the same host, so every response must match — a
  // configured domain silently stopped applying to `example.com.` before.
  for (const pathname of ['/', '/about', '/ru/about']) {
    const plain = await middleware(request({ pathname, host: 'example.com' }));
    const dot = await middleware(request({ pathname, host: 'example.com.' }));
    assert.equal(dot.status, plain.status, pathname);
    assert.equal(dot.headers.get('location'), plain.headers.get('location'), pathname);
    assert.equal(dot.headers.get('x-next-locale'), plain.headers.get('x-next-locale'), pathname);
    // The rewrite keeps the request's own origin, so only the path is compared.
    const rewritePath = (response) => {
      const value = response.headers.get('x-middleware-rewrite');
      return value === null ? null : new URL(value).pathname;
    };
    assert.equal(rewritePath(dot), rewritePath(plain), pathname);
  }
  const crossDomain = await middleware(request({ pathname: '/ru/about', host: 'example.com.' }));
  assert.equal(crossDomain.status, 307);
  assert.equal(crossDomain.headers.get('location'), 'https://example.ru/about');
});

// ---------------------------------------------------------------------------
// V5-04 — the wildcard honours a refusal that comes later in the header
// ---------------------------------------------------------------------------

test('V5-04: a `q=0` entry refuses the locale even when it follows the `*`', () => {
  assert.equal(resolveAcceptLanguage('*;q=0.5,en;q=0', ['en', 'ru'], 'en'), 'ru');
  assert.equal(resolveAcceptLanguage('*,en;q=0', ['en', 'ru'], 'en'), 'ru');
  assert.equal(resolveAcceptLanguage('*;q=0.5,de;q=0', ['en', 'ru'], 'en'), 'en');
});

test('V5-04: an explicit higher-quality tag still wins over the wildcard', () => {
  assert.equal(resolveAcceptLanguage('*;q=0.5,ru;q=0.9,en;q=0', ['en', 'ru'], 'en'), 'ru');
});

// ---------------------------------------------------------------------------
// V5-05 — literal braces are expressible in JSON catalogs
// ---------------------------------------------------------------------------

test('V5-05: `\\{` and `\\}` render as literal braces', () => {
  const ftl = jsonToFluent({
    literal: 'has \\{braces\\}',
    mixed: 'Keep {count} of \\{these\\}',
    only: '\\{\\}',
    untouched: 'Braces { and } here',
  });
  const t = translatorFor(ftl);
  assert.equal(t('literal'), 'has {braces}');
  assert.equal(t('mixed', { count: 2 }), 'Keep 2 of {these}');
  assert.equal(t('only'), '{}');
  assert.equal(t('untouched'), 'Braces { and } here');
});

test('V5-05: an unescaped placeholder still interpolates', () => {
  const t = translatorFor(jsonToFluent({ hello: 'Hello, {name}!' }));
  assert.equal(t('hello', { name: 'Ada' }), 'Hello, Ada!');
});


// ---------------------------------------------------------------------------
// V5-06 — generated types must follow the runtime's key resolution
// ---------------------------------------------------------------------------

const shadowedCatalog = `greeting =
    .formal = Good day, { $name }
greeting-formal = Hey { $nick }
login-button = Log in
    .aria-label = Log in button
`;

test('V5-06: the shadowed key carries the arguments of the winning message', () => {
  const declarations = generateTypeDeclarations(shadowedCatalog);
  assert.match(declarations, /'greeting\.formal': \{ 'nick': string \| number \| Date \};/);
  // Non-shadowed attributes keep their own arguments.
  assert.match(declarations, /'login-button\.aria-label'\?: Record<string, never>;/);
});

test('V5-06: the shadowed attribute is reported in the generated file', () => {
  const declarations = generateTypeDeclarations(shadowedCatalog);
  assert.match(declarations, /Shadowed attributes/);
  assert.match(declarations, /'greeting\.formal' resolves to the message "greeting-formal"/);
  assert.match(declarations, /t\.attrs\('greeting'\)\.formal/);
});

test('V5-06: the declared arguments match what the runtime formats', () => {
  const declarations = generateTypeDeclarations(shadowedCatalog);
  const variables = /'greeting\.formal': \{ '([a-z]+)': /.exec(declarations)?.[1];
  assert.equal(variables, 'nick');

  // The runtime resolves the dashed id first, so `$nick` is the variable the
  // call site must pass — anything else formats to the key.
  const t = translatorFor(shadowedCatalog);
  assert.equal(t('greeting.formal', { nick: 'Ada' }), 'Hey Ada');
  assert.equal(t('greeting.formal', { name: 'Ada' }), 'greeting.formal');
});

test('V5-06: a message shadowing an attribute is the only case that is rewritten', () => {
  const declarations = generateTypeDeclarations(
    'a-b = Message\na =\n    .b = Attribute\n'
  );
  // `t('a.b')` resolves the message `a-b`; its arguments are declared for the
  // key, and the attribute stays reachable through t.attrs('a').b.
  assert.match(declarations, /'a\.b': \{ 'nick'|'a\.b'\?: Record<string, never>;/);
  assert.match(declarations, /'a-b'/);
});

// ---------------------------------------------------------------------------
// V5-10 — public URLs built from an unverified Host
// ---------------------------------------------------------------------------

test('V5-10: a forged loopback x-forwarded-host no longer rewrites the origin', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    localeDetection: false,
  });
  const response = await middleware(
    request({ pathname: '/docs', headers: { 'x-forwarded-host': 'localhost:3000' } })
  );
  const link = response.headers.get('link') ?? '';
  assert.match(link, /<https:\/\/example\.com\/docs>/);
  assert.doesNotMatch(link, /localhost/);
});

test('V5-10: a loopback proxy on a loopback connection is still trusted', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    localeDetection: false,
  });
  const response = await middleware(
    request({ pathname: '/docs', host: '127.0.0.1:3000', headers: { 'x-forwarded-host': 'localhost:3000' } })
  );
  assert.match(response.headers.get('link') ?? '', /<https:\/\/localhost:3000\/docs>/);
});

const linkProbe = `
import { createI18nMiddleware } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'dist', 'middleware.js')).href)};
const middleware = createI18nMiddleware({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed', localeDetection: false });
const response = await middleware({
  url: 'https://example.com/about',
  nextUrl: { pathname: '/about', search: '' },
  cookies: { get: () => undefined },
  headers: { get: (name) => (name.toLowerCase() === 'host' ? 'example.com' : null) },
});
console.log(JSON.stringify({ link: response.headers.get('link') ?? '' }));
`;

function runLinkProbe(env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', linkProbe], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: env },
  });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout.trim().split('\n').pop()), stderr: result.stderr };
}

test('V5-10: the missing-trustedHosts warning covers the Link header, in development only', () => {
  const development = runLinkProbe('development');
  assert.match(development.link, /rel="alternate"/);
  assert.match(development.stderr, /redirect `Location`, alternate `Link`/);

  const production = runLinkProbe('production');
  assert.doesNotMatch(production.stderr, /trustedHosts/);
});

// ---------------------------------------------------------------------------
// V5-11 — the locale cookie is not written when nobody reads it
// ---------------------------------------------------------------------------

const setCookie = (response) => response.headers.getSetCookie?.() ?? [];

test('V5-11: localeDetection keeps writing the cookie by default', async () => {
  const response = await createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  })(request({ pathname: '/ru/docs' }));
  assert.match(setCookie(response).join(' '), /NEXT_LOCALE=ru/);
});

test('V5-11: localeDetection:false writes no cookie', async () => {
  const response = await createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    localeDetection: false,
  })(request({ pathname: '/ru/docs' }));
  assert.deepEqual(setCookie(response), []);
});

test('V5-11: an explicit localeCookie stays an opt-in with detection off', async () => {
  const response = await createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    localeDetection: false,
    localeCookie: { name: 'MY_LOCALE' },
  })(request({ pathname: '/ru/docs' }));
  assert.match(setCookie(response).join(' '), /MY_LOCALE=ru/);
});

// ---------------------------------------------------------------------------
// V5-12 — `*.example.org` is the subdomains, not the apex
// ---------------------------------------------------------------------------

test('V5-12: the wildcard allow-list does not silently accept the apex', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    trustedHosts: ['*.example.org'],
  });
  assert.equal((await middleware(request({ host: 'www.example.org' }))).status, 200);
  assert.equal((await middleware(request({ host: 'example.org' }))).status, 421);
  assert.equal((await middleware(request({ host: 'badexample.org' }))).status, 421);
});

test('V5-12: listing the apex alongside the wildcard accepts both', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    trustedHosts: ['example.org', '*.example.org'],
  });
  assert.equal((await middleware(request({ host: 'example.org' }))).status, 200);
  assert.equal((await middleware(request({ host: 'a.example.org' }))).status, 200);
});
