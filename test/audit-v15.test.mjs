/**
 * Audit pass 15 — see ENGINEERING_AUDIT_V15.md.
 *
 * V12 and V14 both wrote off `client.js` as unreachable in Node. Both were half
 * right: the `useEffect` bodies and one memo genuinely need a renderer, but the
 * provider's own branches — a pre-built bundle passed as `messages`, a single
 * fallback bundle instead of an array, `<FormattedMessage>` with a className —
 * are ordinary render-time code and were simply never asked for.
 *
 * This pass probed first and then wrote the tests, which is the only way the
 * claim "unreachable" gets to be true.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { FluentProvider, FormattedMessage, useTranslations } from '../dist/client.js';
import { createFluentBundle } from '../dist/bundle.js';

/** Fluent wraps interpolated values in bidi isolation marks. */
function plain(text) {
  return String(text).replace(/[⁦-⁩]/g, '');
}

/** Renders one child under a provider, capturing anything the provider warns. */
function render(providerProps, child) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    return { html: renderToStaticMarkup(React.createElement(FluentProvider, providerProps, child)), warnings };
  } finally {
    console.warn = original;
  }
}

/** A component that renders `t(key)` with the given translator. */
function saying(key, namespace) {
  return function Saying() {
    const t = useTranslations(namespace);
    return React.createElement('span', null, t(key));
  };
}

// ---------------------------------------------------------------------------
// A catalog handed over ready-made
// ---------------------------------------------------------------------------
// The provider accepts both source text and an already-built bundle. The second
// path is what a server component hands down through the RSC boundary, and it
// had never been executed.

test('messages given as a built bundle are used as they are', () => {
  const bundle = createFluentBundle('en', 'greet = Hi { $name }\n');
  const { html, warnings } = render(
    { locale: 'en', messages: bundle },
    React.createElement(FormattedMessage, { id: 'greet', values: { name: 'Ada' } })
  );
  assert.equal(plain(html), 'Hi Ada');
  assert.deepEqual(warnings, []);
});

test('fallbackMessages given as a built bundle are used as they are', () => {
  const bundle = createFluentBundle('en', 'greet = Hi\n');
  const { html, warnings } = render(
    { locale: 'ru', messages: 'other = X\n', fallbackLocale: 'en', fallbackMessages: bundle },
    React.createElement(FormattedMessage, { id: 'greet' })
  );
  assert.equal(plain(html), 'Hi');
  assert.deepEqual(warnings, [], 'a bundle has no unparsable entries to warn about');
});

// ---------------------------------------------------------------------------
// Fallback bundles
// ---------------------------------------------------------------------------

test('a fallback bundle is accepted alone or in an array', () => {
  const single = createFluentBundle('en', 'greet = Hi\n');
  const provider = { locale: 'ru', messages: 'other = X\n' };
  const child = React.createElement(saying('greet'));

  assert.equal(
    plain(render({ ...provider, fallbackBundles: single }, child).html),
    '<span>Hi</span>',
    'one bundle must not need wrapping in an array'
  );
  assert.equal(
    plain(render({ ...provider, fallbackBundles: [single] }, child).html),
    '<span>Hi</span>'
  );
});

test('a fallback bundle for the very same locale still resolves', () => {
  // Splitting one locale across files is the normal namespaced setup.
  const bundle = createFluentBundle('en', 'greet = Hi\n');
  const { html, warnings } = render(
    { locale: 'en', messages: 'other = X\n', fallbackBundles: [bundle] },
    React.createElement(saying('greet'))
  );
  assert.equal(plain(html), '<span>Hi</span>');
  assert.deepEqual(warnings, []);
});

test('a key in no bundle at all renders the key and says so once', () => {
  const { html, warnings } = render(
    { locale: 'en', messages: 'other = X\n' },
    React.createElement(saying('greet'))
  );
  assert.equal(plain(html), '<span>greet</span>', 'the key itself is the fallback text');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Missing message "greet"/);
});

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

test('a namespace is resolved through the same candidate list the runtime uses', () => {
  const { html } = render(
    { locale: 'en', messages: 'checkout-total = Total\n' },
    React.createElement(saying('total', 'checkout'))
  );
  assert.equal(plain(html), '<span>Total</span>', '`checkout` + `total` finds `checkout-total`');
});

test('a namespaced key that exists nowhere is reported with its namespace', () => {
  const { html, warnings } = render(
    { locale: 'en', messages: 'other = X\n' },
    React.createElement(saying('total', 'checkout'))
  );
  assert.equal(plain(html), '<span>checkout.total</span>');
  assert.match(warnings[0], /Missing message "checkout\.total"/);
});

// ---------------------------------------------------------------------------
// `<FormattedMessage>` shape
// ---------------------------------------------------------------------------
// A missing message must not cost the caller its markup: a className without a
// component still has to render an element that carries it.

test('a className without a component still produces an element that carries it', () => {
  const { html } = render(
    { locale: 'en', messages: 'greet = Hi\n' },
    React.createElement(FormattedMessage, { id: 'greet', className: 'greeting' })
  );
  assert.equal(plain(html), '<span class="greeting">Hi</span>');
});

test('a component receives the className and the children', () => {
  const as = (props) => React.createElement('b', { className: props.className }, props.children);
  const { html } = render(
    { locale: 'en', messages: 'greet = Hi\n' },
    React.createElement(FormattedMessage, { id: 'greet', className: 'greeting', as })
  );
  assert.equal(plain(html), '<b class="greeting">Hi</b>');
});

test('no className and no component renders the text alone', () => {
  const { html } = render(
    { locale: 'en', messages: 'greet = Hi\n' },
    React.createElement(FormattedMessage, { id: 'greet' })
  );
  assert.equal(plain(html), 'Hi', 'nothing extra is wrapped in for nothing');
});

test('a missing message keeps the caller markup as well', () => {
  const { html } = render(
    { locale: 'en', messages: 'other = X\n' },
    React.createElement(FormattedMessage, { id: 'greet', className: 'greeting' })
  );
  assert.equal(plain(html), '<span class="greeting">greet</span>', 'no throw, no lost class');
});
// ---------------------------------------------------------------------------
// A call that appears before the translator it uses
// ---------------------------------------------------------------------------
// The analyzer resolves a name against the nearest *preceding* binding, and
// falls back to the file's only binding when the call comes first. That fallback
// is what keeps a hoisted helper from being reported as an unknown translator.

test('a call before its binding still resolves against that binding', async () => {
  const { analyzeUsage } = await import('../dist/usage.js');
  const source = [
    "import { useTranslations } from 'next-fluent/client';",
    'export function Card() {',
    "  const label = t('alpha');",
    '  const t = useTranslations();',
    '  return label;',
    '}',
  ].join('\n');

  const report = analyzeUsage({ en: { alpha: 'Alpha' } }, [
    { path: 'app/card.tsx', content: source },
  ]);
  assert.deepEqual([...report.usedKeys], ['alpha'], 'the file has exactly one binding');
  assert.equal(report.dynamicSites, 0);
  assert.deepEqual(
    report.issues.filter((issue) => issue.kind === 'missing'),
    [],
    'an unknown namespace must never become a build failure'
  );
});

test('an expression before its binding is listed, not guessed', async () => {
  const { analyzeUsage } = await import('../dist/usage.js');
  const source = [
    "import { useTranslations } from 'next-fluent/client';",
    'export function Card({ row }) {',
    '  const label = t(row.key);',
    '  const t = useTranslations();',
    '  return label;',
    '}',
  ].join('\n');

  const report = analyzeUsage({ en: { alpha: 'Alpha' } }, [
    { path: 'app/card.tsx', content: source },
  ]);
  assert.equal(report.dynamicSites, 1);
  assert.deepEqual([...report.usedKeys], []);
});
