import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeUsage, formatUsageReport, IGNORE_MARKER } from '../dist/usage.js';

const CATALOG = `
hello = Hello
checkout-title = Checkout
checkout-total = Total
login = Sign in
    .placeholder = Email
    .submit = Sign in
orphan-key = Nobody renders me
banner-text = Text
`;

const file = (path, content) => ({ path, content });

function analyze(sources, options) {
  return analyzeUsage({ en: CATALOG }, sources, { referenceLocale: 'en', ...options });
}

test('resolves namespaced keys exactly like the runtime does', () => {
  // `useTranslations('checkout')` + t('title') must find `checkout-title`
  // (the kebab alias buildKeyCandidates produces), not report it missing.
  const report = analyze([
    file(
      'app/page.tsx',
      [
        "const t = useTranslations('checkout');",
        "t('title');",
        "t('total');",
        'const bare = useTranslations();',
        "bare('hello');",
      ].join('\n')
    ),
  ]);

  assert.deepEqual(report.usedKeys, ['checkout-title', 'checkout-total', 'hello']);
  assert.deepEqual(
    report.issues.filter((issue) => issue.kind === 'missing'),
    [],
    'namespaced keys were reported missing'
  );
});

test('supports the object form of getTranslations', async () => {
  const report = analyze([
    file(
      'app/page.tsx',
      "const t = await getTranslations({ namespace: 'checkout', locale });\nt('total');",
    ),
  ]);
  assert.deepEqual(report.usedKeys, ['checkout-total']);
});

test('reports catalog keys nobody renders', () => {
  const report = analyze([file('app/page.tsx', "const t = useTranslations();\nt('hello');")]);
  const unused = report.issues.filter((issue) => issue.kind === 'unused').map((issue) => issue.key);
  // Everything but `hello`, including the attributes: they are addressable
  // independently, so an attribute nobody renders is dead weight too.
  assert.deepEqual(unused, [
    'banner-text',
    'checkout-title',
    'checkout-total',
    'login',
    'login.placeholder',
    'login.submit',
    'orphan-key',
  ]);
});

test('--allow-unused and ignore prefixes suppress the unused report', () => {
  const off = analyze([file('a.tsx', "const t = useTranslations();\nt('hello');")], {
    reportUnused: false,
  });
  assert.deepEqual(off.issues.filter((issue) => issue.kind === 'unused'), []);

  const partial = analyze([file('a.tsx', "const t = useTranslations();\nt('hello');")], {
    ignore: ['orphan', 'banner'],
  });
  const unused = partial.issues.filter((issue) => issue.kind === 'unused').map((issue) => issue.key);
  assert.ok(!unused.includes('orphan-key'));
  assert.ok(!unused.includes('banner-text'));
  assert.ok(unused.includes('checkout-title'));
});

test('reports keys that are used but missing from the catalog', () => {
  const report = analyze([
    file('app/page.tsx', "const t = useTranslations();\nt('does-not-exist');"),
  ]);
  const missing = report.issues.filter((issue) => issue.kind === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].key, 'does-not-exist');
  assert.equal(missing[0].file, 'app/page.tsx');
  assert.equal(missing[0].line, 2);
});

test('reports call sites that cannot be checked statically', () => {
  const report = analyze([
    file(
      'app/page.tsx',
      [
        'const t = useTranslations();',
        'const key = pick();',
        't(key);',
        't(`item-${id}`);',
      ].join('\n')
    ),
  ]);
  const dynamic = report.issues.filter((issue) => issue.kind === 'dynamic');
  assert.equal(dynamic.length, 2);
  assert.deepEqual(dynamic.map((issue) => issue.line), [3, 4]);
  assert.equal(report.dynamicSites, 2);
});

test('t.attrs on a message without attributes is a defect', () => {
  const withAttributes = analyze([
    file('app/page.tsx', "const t = useTranslations();\nt.attrs('login');"),
  ]);
  assert.deepEqual(withAttributes.issues.filter((i) => i.kind === 'missing-attributes'), []);

  const withoutAttributes = analyze([
    file('app/page.tsx', "const t = useTranslations();\nt.attrs('hello');"),
  ]);
  const issue = withoutAttributes.issues.find((i) => i.kind === 'missing-attributes');
  assert.ok(issue, 'expected a missing-attributes issue');
  assert.equal(issue.key, 'hello');
});

test('t.attrs marks every attribute of the message as used', () => {
  // `t.attrs('login')` spreads all attributes at runtime, so none of them may
  // be reported as dead weight.
  const report = analyze([
    file('app/page.tsx', "const t = useTranslations();\nt.attrs('login');"),
  ]);
  assert.deepEqual(report.usedKeys, ['login', 'login.placeholder', 'login.submit']);
  const unused = report.issues.filter((issue) => issue.kind === 'unused').map((issue) => issue.key);
  assert.ok(!unused.includes('login.placeholder'));
  assert.ok(!unused.includes('login.submit'));
});

test('next-fluent-ignore suppresses one call site', () => {
  const marker = IGNORE_MARKER;
  const report = analyze([
    file(
      'app/page.tsx',
      [
        'const t = useTranslations();',
        `// ${marker}`,
        't(computedKey);',
        "t('hello');",
      ].join('\n')
    ),
  ]);
  assert.deepEqual(report.issues.filter((issue) => issue.kind === 'dynamic'), []);
  assert.equal(report.dynamicSites, 0);
  assert.deepEqual(report.usedKeys, ['hello']);
});

test('formatUsageReport groups findings by severity', () => {
  const report = analyze([
    file(
      'app/page.tsx',
      ['const t = useTranslations();', "t('hello');", "t('nope');", 't(other);'].join('\n')
    ),
  ]);
  const text = formatUsageReport(report);
  assert.match(text, /1\/8 keys used/);
  assert.match(text, /missing \(1\)/);
  assert.match(text, /dynamic \(1\)/);
  assert.match(text, /unused \(\d+\)/);
  // Missing comes before unused: severity order, not insertion order.
  assert.ok(text.indexOf('missing (') < text.indexOf('unused ('));
});

test('an unknown reference locale is refused, not silently empty', () => {
  assert.throws(
    () => analyzeUsage({ en: CATALOG }, [], { referenceLocale: 'de' }),
    /Reference locale "de" is not part of the analyzed catalogs/
  );
});

test('never writes to the catalog and never mutates its inputs', () => {
  const catalogs = { en: CATALOG };
  const sources = [file('app/page.tsx', "const t = useTranslations();\nt('hello');")];
  const before = JSON.stringify({ catalogs, sources });
  analyzeUsage(catalogs, sources, { referenceLocale: 'en' });
  assert.equal(JSON.stringify({ catalogs, sources }), before);
});
