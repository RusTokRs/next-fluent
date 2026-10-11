/**
 * Audit pass 17 — see ENGINEERING_AUDIT_V17.md.
 *
 * V16 closed by suggesting "read the branches, not the lines" in `rich.ts` and
 * `bundle.ts`. That is what this pass did, and both files had something: an
 * error classification that was wrong on one of the five `t.*` entry points,
 * and a catalog reader that silently dropped messages — which made `check`
 * answer "no issues" for translations that were missing.
 *
 * The rest of the file closes branches that turned out to be correct. They were
 * correct, but nothing said so: `parseRichText` without an interactive value,
 * unclosed tags, the value-object unwrapper's three early returns, the `raw()`
 * miss path, LRU eviction, and every `Intl`-refusal fallback in `formatter`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { createFluentBundle, createTranslator } from '../dist/bundle.js';
import { createFormatter } from '../dist/formatter.js';
import { LRUCache } from '../dist/cache.js';
import { parseRichText, stripRichText } from '../dist/rich.js';
import { checkCatalogs } from '../dist/check.js';
import { readCatalogsByLocale } from '../dist/catalog-io.js';
import { createI18nMiddleware } from '../dist/middleware.js';

function withCatalogDir(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v17-'));
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

/** Fluent isolates interpolations with U+2068/U+2069; comparisons drop them. */
const plain = (text) => String(text).replace(/[⁦-⁩]/g, '');

// ---------------------------------------------------------------------------
// V17-01: t.attrs() misclassified an error that t() reported correctly
// ---------------------------------------------------------------------------

/**
 * `{ value: 1 }` is not a Fluent value object: it has no `valueOf` of its own,
 * so Fluent cannot represent it and the name is what the caller needs.
 */
const NOT_A_FLUENT_VALUE = { value: 1 };

const attributeCatalog = createFluentBundle('en', `
field = Amount
    .aria-label = Amount: { $amount }
    .title = Amount { $amount }
`);

function classify(rejectedFrom) {
  const seen = [];
  const t = createTranslator(attributeCatalog, {
    defaultTranslationValues: rejectedFrom === 'default' ? { amount: NOT_A_FLUENT_VALUE } : undefined,
    onError: (error) => seen.push(error),
  });
  t.attrs('field', rejectedFrom === 'call' ? { amount: NOT_A_FLUENT_VALUE } : undefined);
  return seen[0];
}

test('V17-01: t.attrs names the rejected argument wherever it came from', () => {
  for (const source of ['default', 'call']) {
    const error = classify(source);
    assert.equal(error.code, 'INVALID_ARGUMENT', `rejected value from the ${source}`);
    assert.deepEqual(error.cause.unsupportedArguments, ['amount']);
  }
});

test('V17-01: t.attrs and t() classify the same message and the same error alike', () => {
  const seen = [];
  const t = createTranslator(attributeCatalog, {
    defaultTranslationValues: { amount: NOT_A_FLUENT_VALUE },
    onError: (error) => seen.push(error),
  });
  t('field.aria-label');
  const viaKey = seen[0];

  seen.length = 0;
  t.attrs('field');
  const viaAttrs = seen[0];

  assert.equal(viaKey.code, 'INVALID_ARGUMENT');
  assert.equal(viaAttrs.code, viaKey.code, 'one message must not be reported two ways');
  assert.deepEqual(viaAttrs.cause.unsupportedArguments, viaKey.cause.unsupportedArguments);
  // `t()` formats one pattern, `t.attrs` both attributes — the codes and the
  // named argument match, the raw error count is not the same measurement.
  assert.equal(viaKey.cause.errors.length, 1);
  assert.equal(viaAttrs.cause.errors.length, 2);
});

test('V17-01: a real formatting error is still reported as one', () => {
  const seen = [];
  const t = createTranslator(
    createFluentBundle('en', 'only =\n    .label = { NUMBER($n) }\n'),
    { onError: (error) => seen.push(error) }
  );
  t.attrs('only', { n: 'not-a-number' });
  assert.equal(seen[0].code, 'FORMATTING_ERROR');
  assert.equal(seen[0].cause.unsupportedArguments, undefined);
});

// ---------------------------------------------------------------------------
// V17-02: a catalog file was silently dropped, and check said "no issues"
// ---------------------------------------------------------------------------

test('V17-02: a flat catalog and a directory of the same locale are merged', () => {
  withCatalogDir(
    {
      // The directory sorts *after* the file, which is what made the drop.
      'en-x.ftl': 'from_file = A\n',
      'en-z/inner.ftl': 'from_dir = B\n',
      'ru.ftl': 'other = B\n',
    },
    (dir) => {
      const catalogs = readCatalogsByLocale(dir);
      assert.deepEqual(Object.keys(catalogs).sort(), ['en', 'ru']);
      assert.deepEqual(
        catalogs.en.map((source) => source.trim()).sort(),
        ['from_dir = B', 'from_file = A'],
        'both halves of the locale must survive'
      );

      // The consequence: before the fix the reference locale held one key, so
      // `check` compared against an incomplete catalog and found nothing.
      const report = checkCatalogs(catalogs);
      assert.equal(report.keyCount, 2);
      assert.deepEqual(
        report.issues.map((issue) => `${issue.kind}:${issue.locale}:${issue.key}`).sort(),
        ['extra:ru:other', 'missing:ru:from_dir', 'missing:ru:from_file']
      );
    }
  );
});

test('V17-02: order of the merge does not decide which catalog wins', () => {
  const read = (files) => withCatalogDir(files, (dir) => {
    const catalogs = readCatalogsByLocale(dir);
    return {
      sources: catalogs.en.map((source) => source.trim()).sort(),
      duplicates: checkCatalogs(catalogs).issues.filter((issue) => issue.kind === 'duplicate').length,
    };
  });

  const fileFirst = read({ 'en-x.ftl': 'shared = from file\n', 'en-z/inner.ftl': 'shared = from dir\n' });
  const dirFirst = read({ 'en-a/inner.ftl': 'shared = from dir\n', 'en-z.ftl': 'shared = from file\n' });

  assert.deepEqual(fileFirst.sources, dirFirst.sources, 'sort order must not decide what is read');
  assert.equal(fileFirst.sources.length, 2);
  assert.equal(fileFirst.duplicates, 1);
  assert.equal(dirFirst.duplicates, 1);
});

// ---------------------------------------------------------------------------
// V17-03: branches that were correct, and had nothing saying so
// ---------------------------------------------------------------------------

const render = (node) =>
  typeof node === 'string' ? JSON.stringify(node) : renderToStaticMarkup(React.createElement(React.Fragment, null, node));

test('V17-03: markup without an interactive value stays literal text', () => {
  const bold = (children) => React.createElement('b', null, children ?? 'default');
  // Nothing in `values` is a function or an element, so the tags are content.
  assert.equal(render(parseRichText('a <b>bold</b> c', { other: 'str' })), JSON.stringify('a <b>bold</b> c'));
  // One interactive value is enough to switch the whole message to markup.
  assert.equal(render(parseRichText('a <b>bold</b> c', { other: 'str', b: bold })), 'a <b>bold</b> c');
  // A void tag nobody mapped is content too, and never becomes an element.
  assert.equal(render(parseRichText('a <br/> c', { other: 'str' })), JSON.stringify('a <br/> c'));
});

test('V17-03: unclosed and mismatched tags degrade to text, losing nothing', () => {
  const bold = (children) => React.createElement('b', null, children ?? 'default');
  // An open tag with no close is put back as written, children intact.
  assert.equal(render(parseRichText('a <b>bold c', { b: bold })), 'a &lt;b&gt;bold c');
  // A close with no open is not silently swallowed either.
  assert.equal(render(parseRichText('a </b> c', { b: bold })), 'a &lt;/b&gt; c');
  // Nesting that does not line up keeps every character it was given.
  const mismatched = render(parseRichText('<b>a<i>b</b>c', { b: bold, i: bold }));
  assert.ok(mismatched.includes('a') && mismatched.includes('c'), mismatched);
});

test('V17-03: a token whose value is missing stays in the output', () => {
  const token = 'a NF_EL_absent_ c';
  const out = render(parseRichText(token, { b: () => React.createElement('b', null, 'x') }));
  assert.ok(out.includes('NF_EL_absent_'), out);
  // ...and stripRichText removes it, which is what t.plain() has to do.
  assert.ok(!stripRichText(token).includes('NF_EL_absent_'));
});

test('V17-03: values Fluent cannot represent are unwrapped only when that is meaningful', () => {
  const seen = [];
  const onError = (error) => { seen.push(error); return 'FALLBACK'; };
  const catalog = createFluentBundle('en', 'price = { $amount }\n');

  // A value object with its own valueOf is what the unwrapper exists for.
  const wrapped = createTranslator(catalog, { onError });
  assert.equal(plain(wrapped('price', { amount: { value: 7, valueOf: () => 7 } })), '7');

  // No `value` key at all: rejected, and named.
  const bare = createTranslator(catalog, { onError });
  bare('price', { amount: { other: 7 } });
  assert.deepEqual(seen.at(-1).cause.unsupportedArguments, ['amount']);

  // A plain data object keeps `Object.prototype.valueOf`, so it is rejected
  // rather than formatted as "[object Object]".
  const plainObject = createTranslator(catalog, { onError });
  plainObject('price', { amount: { value: 7 } });
  assert.deepEqual(seen.at(-1).cause.unsupportedArguments, ['amount']);

  // A valueOf that throws must not take the whole render down.
  const hostile = createTranslator(catalog, { onError });
  hostile('price', {
    amount: { value: 1, valueOf() { throw new Error('boom'); } },
  });
  assert.deepEqual(seen.at(-1).cause.unsupportedArguments, ['amount']);
});

test('V17-03: raw() covers the miss path and a message with neither value nor attributes', () => {
  const seen = [];
  const t = createTranslator(createFluentBundle('en', 'lonely =\n'), {
    onError: (error) => seen.push(error),
    getMessageFallback: ({ key }) => `fallback:${key}`,
  });
  assert.equal(t.raw('missing-everywhere'), 'fallback:missing-everywhere');
  assert.equal(seen.at(-1).code, 'MISSING_MESSAGE');
  // A message with no value and no attributes has nothing to hand back, and is
  // reported rather than answered with an empty array.
  assert.equal(t.raw('lonely'), 'fallback:lonely');
  assert.equal(seen.at(-1).code, 'MISSING_MESSAGE');
  // Without a custom fallback the key itself is the answer, as documented.
  const plain = createTranslator(createFluentBundle('en', 'x = X\n'));
  assert.equal(plain.raw('nope'), 'nope');
});

test('V17-03: LRU eviction keeps the cache bounded and recency-ordered', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');            // 'a' is now the most recent
  cache.set('c', 3);          // evicts the least recent, 'b'
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size, 2);
  // Re-setting an existing key must not consume a second slot.
  cache.set('a', 9);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), 9);
});

test('V17-03: formatter falls back without throwing when Intl refuses', () => {
  const date = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
  const broken = createFormatter('not a locale!');

  assert.equal(broken.dateTime(date), '2024-01-02T03:04:05.000Z');
  assert.equal(broken.number(1234.5), '1234.5');
  assert.equal(broken.list(['a', 'b']), 'a, b');
  assert.equal(broken.relativeTime(1, 'day'), '1 day');

  // An unusable instant is rendered as given, never through a second throw.
  const fine = createFormatter('en');
  assert.equal(fine.dateTime(new Date(NaN)), 'Invalid Date');
  assert.equal(fine.dateTime('not a date'), 'not a date');
  assert.equal(fine.dateTime({}), '[object Object]');
  // An unknown zone is reported and dropped rather than breaking the render.
  assert.match(createFormatter({ locale: 'en', timeZone: 'Mars/Olympus' }).dateTime(date), /2024/);
});

// ---------------------------------------------------------------------------
// V17-04: the two-layer invariants as a bounded net
// ---------------------------------------------------------------------------

function middlewareRequest(pathname, { host, forwardedHost, headers = {}, cookies = {} } = {}) {
  const url = new URL(pathname, 'https://backend.internal:3000');
  const jar = new Map(Object.entries(cookies));
  const allHeaders = { host, ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}), ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    headers: new Headers(allHeaders),
    cookies: { get: (name) => (jar.has(name) ? { value: jar.get(name) } : undefined) },
  };
}

const TRUSTED = new Set(['example.com', 'shop.test']);
const trustedHost = (host) =>
  TRUSTED.has(host.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, ''));

test('V17-04: the middleware never redirects off-origin and never serves a foreign host', async () => {
  const mw = createI18nMiddleware({
    locales: ['en', 'ru', 'de'],
    defaultLocale: 'en',
    localePrefix: 'always',
    trustedHosts: [...TRUSTED],
    domains: [
      { domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'] },
      { domain: 'shop.test', defaultLocale: 'de', locales: ['de'] },
    ],
  });
  const hosts = ['example.com', 'EXAMPLE.COM', 'example.com.', 'shop.test', 'evil.com', 'example.com:443', 'localhost:3000'];
  const paths = ['/', '/about', '/en/about', '/ru/about', '/de/about', '//evil.test/x', '/%2e%2e/admin', '/en//about', '/about?x=1'];
  const forwarded = [undefined, 'example.com', 'shop.test', 'evil.com', 'example.com:443', 'example.com,evil.com'];
  const variants = [
    {},
    { 'accept-language': 'ru' },
    { 'accept-language': 'de;q=0.9,ru;q=0.8' },
    { 'sec-fetch-dest': 'document' },
    { 'sec-fetch-dest': 'empty' },
  ];

  let checked = 0;
  for (const host of hosts) {
    for (const pathname of paths) {
      for (const forwardedHost of forwarded) {
        for (const headers of variants) {
          for (const cookies of [{}, { NEXT_LOCALE: 'ru' }, { NEXT_LOCALE: 'bogus!!' }]) {
            checked++;
            const response = await mw(middlewareRequest(pathname, { host, forwardedHost, headers, cookies }));
            const location = response.headers.get('location');
            if (location) {
              const target = new URL(location);
              assert.ok(
                trustedHost(target.host),
                `redirect left the trusted origins: ${location} (host=${host} path=${pathname})`
              );
            }
            assert.ok(
              trustedHost(host) || response.status === 421,
              `a foreign host was served: ${host} + ${forwardedHost} -> ${response.status}`
            );
          }
        }
      }
    }
  }
  assert.ok(checked > 2000, `the net must stay wide, checked only ${checked}`);
});

test('V17-04: every redirect chain converges instead of looping', async () => {
  const pathnames = { '/about': { en: '/about-us', ru: '/o-nas' }, '/docs': '/docs' };
  const mw = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
    pathnames,
    trustedHosts: ['example.com'],
  });
  const starts = ['/', '/about', '/about-us', '/o-nas', '/en', '/ru', '/en/about', '/ru/about', '/about/', '/en/docs/'];

  for (const cookies of [{}, { NEXT_LOCALE: 'ru' }]) {
    for (const start of starts) {
      let pathname = start;
      const seen = new Set([pathname]);
      for (let hop = 0; hop < 8; hop++) {
        const response = await mw(middlewareRequest(pathname, { host: 'example.com', cookies }));
        const location = response.headers.get('location');
        if (!location) break;
        pathname = new URL(location).pathname;
        assert.ok(!seen.has(pathname), `redirect loop: ${start} -> ${pathname}`);
        seen.add(pathname);
      }
      assert.ok(seen.size < 8, `${start} did not converge`);
    }
  }
});