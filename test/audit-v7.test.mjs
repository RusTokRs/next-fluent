/**
 * Regression tests for the seventh audit pass — see ENGINEERING_AUDIT_V6.md.
 *
 * Every test here fails on the source revision the pass started from; the
 * findings are numbered as in the report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluentNumber } from '@fluent/bundle';
import {
  createFluentBundle,
  createTranslator,
  extractMessagesFromFtl,
  resolveLocalizedPathname,
} from '../dist/index.js';
import { absoluteUrlFromObject } from '../dist/nav-url.js';
import { checkCatalogs } from '../dist/check.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { createFormatter, clearFormatterCache } from '../dist/formatter.js';
import { getOrCreateResource } from '../dist/cache.js';
import { readCatalog } from '../dist/catalog-io.js';
import { setRequestConfig, getRequestConfigSnapshot, forLocale } from '../dist/server.js';

const silent = { onError: () => {} };

/** Collects `console.warn` output produced by `run`. */
function captureWarnings(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// V6-01: backslash normalization could hand out a protocol-relative href
// ---------------------------------------------------------------------------
test('V6-01: a backslash href never resolves to another origin', () => {
  const configs = {
    'as-needed': { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed' },
    never: { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never' },
    always: { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' },
  };
  for (const [name, config] of Object.entries(configs)) {
    const out = resolveLocalizedPathname({ href: '/\\evil.example' }, config);
    assert.ok(!out.startsWith('//'), `${name}: ${out} is protocol-relative`);
    assert.equal(
      new URL(out, 'https://site.example').origin,
      'https://site.example',
      `${name}: ${out} left the origin`
    );
  }
});

test('V6-01: backslashes collapse into an internal path, basePath strip included', () => {
  const asNeeded = { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed' };
  assert.equal(resolveLocalizedPathname({ href: '/\\docs' }, asNeeded), '/docs');
  assert.equal(
    resolveLocalizedPathname({ href: '/\\docs' }, { ...asNeeded, basePath: '/app' }),
    '/app/docs'
  );
  // The basePath strip can expose a second leading slash of its own; the
  // result stays on the origin and keeps the basePath.
  const stripped = resolveLocalizedPathname(
    { href: '/app/\\evil.example' },
    { ...asNeeded, basePath: '/app' }
  );
  assert.equal(stripped, '/app/evil.example');
  assert.ok(!stripped.startsWith('//'));
  // A genuine external URL is still passed through untouched.
  assert.equal(resolveLocalizedPathname({ href: '//evil.example/x' }, asNeeded), '//evil.example/x');
  // Object hrefs already refused protocol-relative pathnames.
  assert.throws(
    () => resolveLocalizedPathname({ href: { pathname: '//evil.example' } }, asNeeded),
    /internal path/
  );
});

// ---------------------------------------------------------------------------
// V6-02: a non-numeric `port` could rewrite the authority of an object href
// ---------------------------------------------------------------------------
test('V6-02: numeric ports are honoured, everything else is rejected', () => {
  assert.equal(
    absoluteUrlFromObject({ pathname: '/a', hostname: 'example.com', port: '3000' }),
    'https://example.com:3000/a'
  );
  assert.equal(
    absoluteUrlFromObject({ pathname: '/a', hostname: 'example.com', port: 8443 }),
    'https://example.com:8443/a'
  );
  for (const port of ['@evil.com', '80/../x', 'x', '12 34', '3000/', '-1']) {
    assert.throws(
      () => absoluteUrlFromObject({ pathname: '/a', hostname: 'example.com', port }),
      /port must be numeric/,
      `port ${JSON.stringify(port)} was accepted`
    );
  }
  // The former behaviour produced `https://example.com:@evil.com/a`, which the
  // URL parser reads as userinfo + host `evil.com`.
  assert.throws(
    () =>
      resolveLocalizedPathname(
        { href: { pathname: '/a', hostname: 'example.com', port: '@evil.com' } },
        { locales: ['en'], defaultLocale: 'en', localePrefix: 'as-needed' }
      ),
    /port must be numeric/
  );
});

// ---------------------------------------------------------------------------
// V6-03: an unknown timeZone silently produced ISO strings
// ---------------------------------------------------------------------------
test('V6-03: an unknown timeZone is reported and still formats locally', () => {
  clearFormatterCache();
  const formatter = createFormatter({ locale: 'en', timeZone: 'Not/AZone' });
  const warnings = captureWarnings(() => {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    const first = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), options);
    const second = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), options);
    assert.equal(first, second);
    assert.ok(!first.includes('.000Z'), `fell back to ISO output: ${first}`);
    assert.match(first, /2026/);
  });
  assert.equal(warnings.filter((w) => w.includes('Unknown time zone')).length, 1, warnings.join('\n'));
});

test('V6-03: a valid timeZone keeps working and stays quiet', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en', timeZone: 'UTC' });
    const utc = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    const berlin = createFormatter({ locale: 'en', timeZone: 'Europe/Berlin' }).dateTime(
      new Date('2026-01-02T03:04:05Z'),
      { hour: '2-digit', minute: '2-digit', hour12: false }
    );
    assert.match(String(utc), /03:04/);
    assert.match(String(utc), /UTC/);
    assert.match(berlin, /04:04/);
  });
  assert.deepEqual(warnings, []);
});

test('V6-03: a per-call timeZone is validated as well', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
    const out = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), {
      timeZone: 'Bogus/Zone',
      dateStyle: 'short',
    });
    assert.ok(!out.includes('.000Z'), out);
  });
  assert.equal(warnings.filter((w) => w.includes('Bogus/Zone')).length, 1, warnings.join('\n'));
});

// ---------------------------------------------------------------------------
// V6-04: a UTF-8 BOM silently dropped the first catalog entry
// ---------------------------------------------------------------------------
test('V6-04: a byte-order mark no longer costs the first message', () => {
  const bundle = createFluentBundle('en', '\uFEFFfirst = One\nsecond = Two', {
    useIsolating: false,
    disableCache: true,
  });
  const t = createTranslator(bundle, silent);
  assert.equal(t('first'), 'One');
  assert.equal(t('second'), 'Two');
});

test('V6-04: both spellings share one parsed resource', () => {
  assert.equal(getOrCreateResource('\uFEFFshared = X'), getOrCreateResource('shared = X'));
});

test('V6-04: catalog tooling reads a BOM too', () => {
  assert.deepEqual(
    extractMessagesFromFtl('\uFEFFa = A\nb = B').map((message) => message.id),
    ['a', 'b']
  );
  assert.deepEqual(checkCatalogs({ en: '\uFEFFa = A', ru: 'a = Б' }).issues, []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-bom-'));
  try {
    const file = path.join(dir, 'en.json');
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ hello: 'Hi' })}`, 'utf8');
    assert.equal(readCatalog(file).trim(), 'hello = Hi');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// V6-05: entries the runtime parser cannot read vanished without a trace
// ---------------------------------------------------------------------------
/** Collects `console.warn` output produced by an async `run`. */
async function captureWarningsAsync(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('V6-05: an unreadable entry is reported with its id', async () => {
  let translator;
  const warnings = await captureWarningsAsync(async () => {
    translator = await forLocale('en', {
      messages: 'good = Ok\nbad = { $x -> [one] one }',
    });
  });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /cannot read/);
  assert.match(warnings[0], /"bad"/);
  // …and the prediction is right: the entry really is missing at runtime.
  assert.equal(translator('good'), 'Ok');
  assert.equal(translator('bad'), 'bad');
});

test('V6-05: a readable catalog stays silent', async () => {
  const valid = [
    'multi = Line one',
    '    line two',
    'attr-msg = Value',
    '    .label = Label',
    'selector = { $n ->',
    '    [one] one',
    '   *[other] other',
    '}',
    'same = A',
    'same = B',
    'uses-term = { -brand }',
    '-brand = Brand',
  ].join('\n');
  const warnings = await captureWarningsAsync(async () => {
    const t = await forLocale('en', { messages: valid });
    assert.equal(t('multi'), 'Line one\nline two');
    assert.equal(t('same'), 'B');
    assert.equal(t('uses-term'), 'Brand');
  });
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// V6-06: FluentType-shaped values from another package copy were unusable
// ---------------------------------------------------------------------------
test('V6-06: a foreign FluentType-shaped value is unwrapped to its primitive', () => {
  const t = createTranslator(
    createFluentBundle('en', 'v = Value: { $x }', { useIsolating: false }),
    silent
  );
  // The exact shape of a `FluentNumber` from a second copy of @fluent/bundle.
  assert.equal(t('v', { x: { value: 5, type: 'number', valueOf: () => 5 } }), 'Value: 5');
  // An application value object (`Money`) is formatted through `valueOf` too.
  class Money {
    constructor(value) {
      this.value = value;
    }
    valueOf() {
      return this.value;
    }
  }
  assert.equal(t('v', { x: new Money(12) }), 'Value: 12');
  // The local copy keeps working exactly as before.
  assert.equal(t('v', { x: new FluentNumber(7) }), 'Value: 7');
});

test('V6-06: a plain data object is reported as an invalid argument', () => {
  const errors = [];
  const t = createTranslator(createFluentBundle('en', 'v = Value: { $x }', { useIsolating: false }), {
    onError: (error) => errors.push(error),
  });
  assert.equal(t('v', { x: { value: 1 } }), 'v');
  assert.deepEqual(
    errors.map((error) => error.code),
    ['INVALID_ARGUMENT']
  );
  assert.match(String(errors[0].message), /Invalid argument/);
});

// ---------------------------------------------------------------------------
// V6-07: a snapshot for another locale used to replace the request locale
// ---------------------------------------------------------------------------
test('V6-07: a snapshot still reports the locale it was taken for', async () => {
  setRequestConfig(async ({ locale }) => ({ locale, messages: 'hello = Hello' }));
  try {
    const snapshot = await getRequestConfigSnapshot('ru');
    assert.equal(snapshot.locale, 'ru');
    assert.equal(typeof snapshot.timeZone, 'string');
    assert.ok(snapshot.now instanceof Date);
  } finally {
    setRequestConfig(() => ({ locale: 'en', messages: '' }));
  }
});

// The request-scope half of this fix — a snapshot taken for another locale must
// not replace the locale the request resolved — needs a real React request
// scope, which plain `react-dom/server` in this suite does not provide. It is
// asserted end-to-end by scripts/test-next-integration.mjs through
// `data-scope-locale-after-snapshot` on the fixture's `/live` route.

// ---------------------------------------------------------------------------
// V6-08: a cyclic options object overflowed the stack
// ---------------------------------------------------------------------------
test('V6-08: cyclic Intl options do not overflow the stack', () => {
  const options = { style: 'decimal' };
  options.self = options;
  options.list = [options];
  const number = createFormatter({ locale: 'en' }).number(5, options);
  assert.equal(number, '5');
  const dateTime = createFormatter({ locale: 'en' }).dateTime(new Date(0), { ...options });
  assert.ok(typeof dateTime === 'string' && dateTime.length > 0);
});

// ---------------------------------------------------------------------------
// V6-09: a domain configured with a trailing dot never matched
// ---------------------------------------------------------------------------
test('V6-09: an absolute (dotted) domain spelling still routes', async () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
    localeDetection: false,
    alternateLinks: false,
    // The absolute spelling of `example.com` — the same host to every resolver.
    domains: [{ domain: 'example.com.', defaultLocale: 'en', locales: ['en'], localePrefix: 'never' }],
  };
  const middleware = createI18nMiddleware(config);
  const url = new URL('/docs', 'https://example.com.');
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  let response;
  try {
    response = await middleware({
      url: url.toString(),
      nextUrl: { pathname: '/docs', search: '' },
      headers: new Headers({ host: 'example.com.' }),
      cookies: { get: () => undefined },
    });
  } finally {
    console.warn = original;
  }
  // The domain's `localePrefix: 'never'` applies instead of the global
  // `always`, so the request is served rather than redirected to `/en/docs`.
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.status, 200);
});
