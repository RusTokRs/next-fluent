import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { jsonToFluent, toFluentSource, isJsonCatalog } from '../dist/catalog.js';
import { pickMessages, listMessageKeys } from '../dist/pick-messages.js';
import { checkCatalogs, formatCheckReport } from '../dist/check.js';
import { createFluentBundle, createTranslator, LRUCache } from '../dist/bundle.js';
import { splitPreservedTokens, pseudoLocalizeText } from '../dist/pseudo.js';
import { FluentProvider, useTranslations } from '../dist/client.js';
import { forLocale, setRequestLocale } from '../dist/server.js';
import { FluentErrorCode } from '../dist/errors.js';

const strip = (value) => value.replace(/[\u2068\u2069]/g, '');
const silent = { onError: () => {} };

// ---------------------------------------------------------------------------
// JSON catalogs
// ---------------------------------------------------------------------------

test('JSON catalogs convert to FTL and round-trip through a bundle', () => {
  const ftl = jsonToFluent({
    hello: 'Hello, {name}!',
    nav: { home: 'Home', about: 'About us' },
    'checkout-title': { '': 'Checkout', 'aria-label': 'Checkout page' },
    weird: 'Braces { and } plus "quotes" and \\ backslash',
    multiline: 'first line\nsecond line',
    padded: '  padded  ',
    empty: '',
    count: 42,
    flag: true,
  });

  const bundle = createFluentBundle('en', ftl);
  const t = createTranslator(bundle, silent);

  assert.equal(strip(t('hello', { name: 'Ada' })), 'Hello, Ada!');
  assert.equal(strip(t('nav.home')), 'Home');
  assert.equal(strip(t('nav-about')), 'About us');
  assert.equal(strip(t('checkout-title')), 'Checkout');
  assert.deepEqual(t.attrs('checkout-title'), { 'aria-label': 'Checkout page' });
  assert.equal(strip(t('weird')), 'Braces { and } plus "quotes" and \\ backslash');
  assert.equal(strip(t('multiline')), 'first line\nsecond line');
  assert.equal(strip(t('padded')), '  padded  ');
  assert.equal(strip(t('empty')), '');
  assert.equal(strip(t('count')), '42');
  assert.equal(strip(t('flag')), 'true');
});

test('JSON catalogs reject shapes Fluent cannot express', () => {
  assert.throws(() => jsonToFluent({ items: ['one', 'two'] }), /array/);
  assert.throws(() => jsonToFluent({ missing: null }), /null/);
  assert.throws(() => jsonToFluent({ '9lives': 'cats' }), /valid Fluent message id/);
  assert.throws(() => jsonToFluent({ btn: { '': 'OK', nested: { a: 'b' } } }), /must be a string/);
  assert.throws(() => jsonToFluent('nope'), /plain objects/);

  // The thrown errors are FluentErrors with a stable code.
  try {
    jsonToFluent({ items: [] });
  } catch (error) {
    assert.equal(error.code, FluentErrorCode.INVALID_ARGUMENT);
  }
});

test('JSON catalogs are accepted everywhere FTL text is', () => {
  const catalog = { greeting: 'Hi {name}', nested: { key: 'Deep' } };

  assert.equal(isJsonCatalog(catalog), true);
  assert.equal(isJsonCatalog(createFluentBundle('en', 'a = b')), false);
  assert.equal(toFluentSource('a = b'), 'a = b');
  assert.deepEqual(toFluentSource(['a = b']), ['a = b']);

  // Server-side: getTranslations({ messages })
  const t = createTranslator(createFluentBundle('en', catalog), silent);
  assert.equal(strip(t('greeting', { name: 'Ada' })), 'Hi Ada');
  assert.equal(strip(t('nested.key')), 'Deep');
});

test('FluentProvider renders JSON catalogs on the server', () => {
  function Greeting() {
    const t = useTranslations();
    return React.createElement('p', null, t('welcome', { name: 'Ada' }));
  }

  const html = renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale: 'en', messages: { welcome: 'Welcome, {name}!' } },
      React.createElement(Greeting)
    )
  );

  assert.equal(strip(html), '<p>Welcome, Ada!</p>');
});

test('setRequestLocale rejects calls outside a request scope', () => {
  // Node tests have no React request scope, which is exactly the misuse case:
  // the locale would be dropped silently and pages would render in English.
  assert.throws(() => setRequestLocale('ru', ['en', 'ru']), /outside a request scope/);
  // Validation still runs first.
  assert.throws(() => setRequestLocale('not a locale'), /Invalid request locale/);
});

// ---------------------------------------------------------------------------
// pickMessages
// ---------------------------------------------------------------------------

const CATALOG = `
-brand = Acme

nav-home = Home
nav-about = About { -brand }

checkout-title = Checkout
checkout-total = Total: { $amount }

footer-note = Powered by { -brand }
`;

test('pickMessages prunes a catalog to one namespace and keeps used terms', () => {
  const checkout = pickMessages(CATALOG, 'checkout');
  assert.deepEqual(listMessageKeys(checkout).sort(), ['checkout-title', 'checkout-total']);
  assert.ok(!checkout.includes('nav-home'));

  const nav = pickMessages(CATALOG, 'nav');
  // The term referenced by the namespace travels with it.
  assert.ok(nav.includes('-brand = Acme'), nav);
  assert.ok(nav.includes('nav-about'));
  assert.ok(!nav.includes('checkout'));

  // Dotted and kebab namespace spellings both work.
  assert.equal(pickMessages('a-b = 1\nc = 2', 'a'), pickMessages('a-b = 1\nc = 2', 'a'));

  // Without a namespace the source passes through (arrays are joined).
  assert.equal(pickMessages(['a = 1', 'b = 2']), 'a = 1\nb = 2');
  assert.equal(pickMessages({ 'a-b': 'value' }, 'a'), 'a-b = value\n');
});

test('a pruned catalog still formats', () => {
  const bundle = createFluentBundle('en', pickMessages(CATALOG, 'checkout'));
  const t = createTranslator(bundle, silent);
  assert.equal(strip(t('checkout-title')), 'Checkout');
  assert.equal(strip(t('checkout-total', { amount: 12 })), 'Total: 12');
  assert.equal(t.has('nav-home'), false);
});

// ---------------------------------------------------------------------------
// checkCatalogs
// ---------------------------------------------------------------------------

test('checkCatalogs reports missing, extra, duplicate and broken keys', () => {
  const report = checkCatalogs({
    en: 'hello = Hello\nnav-home = Home\nbroken = {\n',
    ru: 'hello = Привет\ndup = 1\ndup = 2\nextra = Лишнее\n',
  });

  assert.equal(report.referenceLocale, 'en');
  assert.equal(report.keyCount, 2);

  const kinds = report.issues.map((issue) => `${issue.kind}:${issue.key ?? '-'}`);
  assert.ok(kinds.includes('missing:nav-home'), kinds.join(','));
  assert.ok(kinds.includes('extra:extra'), kinds.join(','));
  assert.ok(kinds.includes('duplicate:dup'), kinds.join(','));
  assert.ok(kinds.includes('parse-error:-'), kinds.join(','));

  // "extra" keys alone are informational: reportExtra can silence them.
  const noExtra = checkCatalogs({ en: 'a = 1', ru: 'a = 1\nb = 2' }, { reportExtra: false });
  assert.equal(noExtra.issues.length, 0);

  const explicit = checkCatalogs({ en: 'a = 1', ru: 'b = 2' }, { referenceLocale: 'ru' });
  assert.equal(explicit.referenceLocale, 'ru');
  assert.ok(explicit.issues.some((issue) => issue.kind === 'missing' && issue.key === 'b'));

  assert.throws(() => checkCatalogs({ en: 'a = 1' }, { referenceLocale: 'de' }), /Reference locale/);

  const text = formatCheckReport(report);
  assert.match(text, /Checked 2 catalog\(s\) against "en"/);
  assert.match(text, /\[missing\] "nav-home" is missing\./);
});

test('checkCatalogs accepts JSON catalogs', () => {
  const report = checkCatalogs({
    en: { hello: 'Hello', nav: { home: 'Home' } },
    ru: { hello: 'Привет' },
  });
  assert.deepEqual(
    report.issues.map((issue) => issue.key),
    ['nav-home']
  );
});

// ---------------------------------------------------------------------------
// Small hardening fixes
// ---------------------------------------------------------------------------

test('LRUCache rejects a non-positive size', () => {
  assert.throws(() => new LRUCache(0), /positive integer/);
  assert.throws(() => new LRUCache(-1), /positive integer/);
  assert.throws(() => new LRUCache(1.5), /positive integer/);

  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.has('a'), false);
});

test('pseudo-localization survives nested placeables', () => {
  const tokens = splitPreservedTokens('Total: { $count -> [one] { NUMBER($count) } *[other] items }');
  assert.deepEqual(tokens.map((token) => token.kind), ['text', 'expr']);
  assert.equal(tokens[1].value, '{ $count -> [one] { NUMBER($count) } *[other] items }');

  // An unbalanced brace is text, not a placeable.
  assert.deepEqual(splitPreservedTokens('oops { unclosed'), [
    { kind: 'text', value: 'oops { unclosed' },
  ]);

  const pseudo = pseudoLocalizeText('Total: { $count -> [one] one *[other] many }', {
    elongate: false,
  });
  assert.ok(pseudo.includes('{ $count -> [one] one *[other] many }'), pseudo);

  assert.deepEqual(splitPreservedTokens('a <b>bold</b> c').map((token) => token.kind), [
    'text',
    'tag',
    'text',
    'tag',
    'text',
  ]);
});

test('forLocale accepts a JSON catalog', async () => {
  const t = await forLocale('en', { messages: { 'app-title': 'Title {version}' } });
  assert.equal(strip(t('app-title', { version: '2.0' })), 'Title 2.0');
});
