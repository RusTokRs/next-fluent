import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { analyzeUsage } from '../dist/usage.js';
import { checkCatalogs } from '../dist/check.js';
import { createFluentBundle, createTranslator } from '../dist/bundle.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { FluentProvider, FormattedMessage } from '../dist/client.js';

const CATALOG = `
hello = Hello
rich = Click <b>here</b> now
list = ["a", "b"]
attr-only =
    .label = Label
    .title = Title
`;

const file = (path, content) => ({ path, content });

function analyze(source) {
  return analyzeUsage({ en: CATALOG }, [file('app/page.tsx', source)], {
    referenceLocale: 'en',
  });
}

// ---------------------------------------------------------------------------
// V4-01: `t.raw()` call sites were invisible
// ---------------------------------------------------------------------------

test('a key used only through t.raw is not reported as unused', () => {
  const report = analyze([
    'const t = useTranslations();',
    "const list = t.raw('list');",
  ].join('\n'));

  assert.ok(report.usedKeys.includes('list'), `usedKeys: ${report.usedKeys.join(', ')}`);
  const unused = report.issues.filter((issue) => issue.kind === 'unused').map((issue) => issue.key);
  assert.ok(!unused.includes('list'), `list was reported unused: ${unused.join(', ')}`);
  assert.equal(report.dynamicSites, 0);
});

test('t.raw on an attribute-only message counts its attributes as used', () => {
  const report = analyze([
    'const t = useTranslations();',
    "const values = t.raw('attr-only');",
  ].join('\n'));

  assert.deepEqual(report.usedKeys, ['attr-only', 'attr-only.label', 'attr-only.title']);
  const unused = report.issues.filter((issue) => issue.kind === 'unused').map((issue) => issue.key);
  assert.deepEqual(unused, ['hello', 'list', 'rich']);
});

// ---------------------------------------------------------------------------
// V4-02: `t.plain()` was treated as if it read attributes
// ---------------------------------------------------------------------------

test('t.plain on a message without attributes is not a defect', () => {
  const report = analyze([
    'const t = useTranslations();',
    "const label = t.plain('rich');",
  ].join('\n'));

  assert.deepEqual(
    report.issues.filter((issue) => issue.kind === 'missing-attributes'),
    []
  );
  assert.ok(report.usedKeys.includes('rich'));
});

test('t.plain on an attribute-only message is reported: it can never format text', () => {
  const issue = analyze([
    'const t = useTranslations();',
    "const label = t.plain('attr-only');",
  ].join('\n')).issues.find((item) => item.kind === 'missing-attributes');

  assert.ok(issue, 'expected a missing-attributes issue');
  assert.equal(issue.key, 'attr-only');
  assert.match(issue.message, /defines only attributes and no value/);
});

test('t.plain addressing an attribute path is not flagged', () => {
  // `t.plain('login.submit')` formats the attribute through the same dotted
  // path the runtime resolves, so it must not be reported as attribute-less.
  const report = analyzeUsage(
    { en: 'login = Sign in\n    .submit = Submit\n' },
    [file('app/page.tsx', ["const t = useTranslations();", "const label = t.plain('login.submit');"].join('\n'))],
    { referenceLocale: 'en' }
  );

  assert.deepEqual(
    report.issues.filter((issue) => issue.kind !== 'unused'),
    []
  );
  assert.deepEqual(report.usedKeys, ['login.submit']);
});

test('t.attrs on a message without attributes is still a defect', () => {
  const issue = analyze([
    'const t = useTranslations();',
    "const attrs = t.attrs('hello');",
  ].join('\n')).issues.find((item) => item.kind === 'missing-attributes');

  assert.ok(issue, 'expected a missing-attributes issue');
  assert.equal(issue.key, 'hello');
});

// ---------------------------------------------------------------------------
// V4-03: the duplicate-entry message named the wrong winner
// ---------------------------------------------------------------------------

test('duplicate catalogs entries are reported as last-wins', () => {
  const report = checkCatalogs({ en: 'dup = one\ndup = two\n' });
  const duplicate = report.issues.find((issue) => issue.kind === 'duplicate');

  assert.ok(duplicate, 'expected a duplicate issue');
  // `addResource({ allowOverrides: true })` keeps the last definition, and
  // typegen agrees; telling translators "first" points them at the wrong entry.
  assert.match(duplicate.message, /keeps the last definition/);
  assert.doesNotMatch(duplicate.message, /first definition/);
});

// ---------------------------------------------------------------------------
// V4-04: dead duplicate definitions in bundle.ts
// ---------------------------------------------------------------------------

test('bundle.ts defines each translator method exactly once', () => {
  const source = readFileSync(new URL('../src/bundle.ts', import.meta.url), 'utf8');

  for (const method of ['raw', 'rich', 'attrs', 'plain', 'has']) {
    const assignments = source.match(new RegExp(`tFn\\.${method}\\s*=`, 'g')) ?? [];
    assert.equal(
      assignments.length,
      1,
      `tFn.${method} is assigned ${assignments.length} times; a later assignment would silently win`
    );
  }
});

// ---------------------------------------------------------------------------
// V4-01b: `t.has` sees attribute-only messages, `t()` does not
// ---------------------------------------------------------------------------

test('t.has on an attribute-only message is not a defect', () => {
  const report = analyze([
    'const t = useTranslations();',
    "if (t.has('attr-only')) return null;",
  ].join('\n'));

  assert.ok(report.usedKeys.includes('attr-only'), report.usedKeys.join(', '));
  assert.deepEqual(
    report.issues.filter((issue) => issue.kind !== 'unused'),
    []
  );
});

test('t() on an attribute-only message is reported once as missing-attributes', () => {
  const issues = analyze([
    'const t = useTranslations();',
    "const label = t('attr-only');",
  ].join('\n')).issues;

  const flagged = issues.filter((issue) => issue.kind === 'missing-attributes');
  assert.equal(flagged.length, 1, JSON.stringify(issues, null, 2));
  assert.match(flagged[0].message, /defines only attributes and no value/);
});

// ---------------------------------------------------------------------------
// V4-04: `has()` answers renderability, so FormattedMessage falls back
// ---------------------------------------------------------------------------

test('t.has mirrors what t() can render', () => {
  const bundle = createFluentBundle(
    'en',
    'full = Text\nattr-only =\n    .label = L\n'
  );
  const t = createTranslator(bundle, { onError: () => {} });

  assert.equal(t.has('full'), true);
  assert.equal(t.has('attr-only'), false, 'a message without a value is not renderable');
  assert.equal(t.has('attr-only.label'), true, 'attribute paths stay queryable');
  assert.equal(t.has('missing'), false);
});

test('FormattedMessage renders its fallback for a message without a value', () => {
  const messages = 'full = Full text\nattr-only =\n    .label = L\n';
  const render = (id, fallback) =>
    renderToStaticMarkup(
      React.createElement(
        FluentProvider,
        { locale: 'en', messages },
        React.createElement(FormattedMessage, { id, fallback })
      )
    );

  // SSRing `t(id)` for an attribute-only message falls back to the key, which
  // used to be rendered even though the caller supplied a fallback.
  assert.equal(render('attr-only', 'FB'), 'FB');
  assert.equal(render('full', 'FB'), 'Full text');
  assert.equal(render('missing', 'FB'), 'FB');
});

// ---------------------------------------------------------------------------
// V4-05: the rewrite signal is bound to a per-process token
// ---------------------------------------------------------------------------

const MIDDLEWARE_ROUTING = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
};

function middlewareRequest(path, headers = {}) {
  const url = new URL(path, 'http://localhost:3000');
  const all = { host: 'localhost:3000', ...headers };
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: { get: () => undefined },
    headers: {
      get: (name) => all[name.toLowerCase()] ?? null,
      forEach: (callback) => Object.entries(all).forEach(([key, value]) => callback(value, key)),
    },
  };
}

test('a forged rewrite signal cannot pin the internal alias of a canonical URL', async () => {
  const mw = createI18nMiddleware(MIDDLEWARE_ROUTING);

  // `/en/about` is the internal target of `/about-us`; a document request must
  // canonicalize no matter which headers the client sends.
  const forged = await mw(
    middlewareRequest('/en/about', { 'x-next-fluent-rewrite': '/en/about' })
  );
  assert.equal(forged.status, 307);
  assert.equal(new URL(forged.headers.get('location')).pathname, '/about-us');

  const forgedWithToken = await mw(
    middlewareRequest('/en/about', {
      'x-next-fluent-rewrite': '/en/about',
      'x-next-fluent-rewrite-token': 'not-the-token',
    })
  );
  assert.equal(forgedWithToken.status, 307);
});

test('the genuine second pass is recognized and never leaks its token to the app', async () => {
  const mw = createI18nMiddleware(MIDDLEWARE_ROUTING);

  const first = await mw(middlewareRequest('/about-us'));
  const forwarded = first.request.headers;
  const signal = forwarded.get('x-next-fluent-rewrite');
  const token = forwarded.get('x-next-fluent-rewrite-token');
  assert.equal(signal, '/en/about');
  assert.ok(token, 'the rewrite must carry a token');

  const second = await mw(
    middlewareRequest('/en/about', {
      'x-next-fluent-rewrite': signal,
      'x-next-fluent-rewrite-token': token,
    })
  );
  assert.equal(second.headers.get('x-middleware-next'), '1');
  assert.equal(second.headers.get('location'), null);
  // The fixed point strips the internal headers before the request reaches the
  // application, so a route cannot leak them.
  assert.equal(second.request.headers.get('x-next-fluent-rewrite'), null);
  assert.equal(second.request.headers.get('x-next-fluent-rewrite-token'), null);
});
