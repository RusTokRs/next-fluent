import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analyzeUsage } from '../dist/usage.js';
import { checkCatalogs } from '../dist/check.js';

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
