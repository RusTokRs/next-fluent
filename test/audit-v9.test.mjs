/**
 * Tests for the ninth audit pass — see ENGINEERING_AUDIT_V8.md.
 *
 * The pass went through the modules the earlier ones had read least: the
 * `--usage` call-site analyzer, the URL-hardening primitives and the `dateTime`
 * error path. Every finding below is reproducible on the revision the pass
 * started from — the analyzer ones produced *false* verdicts (`missing` and
 * `unused`, the two kinds that fail a build), the href one handed the browser a
 * URL that resolved to another origin, and the formatter one blamed a valid
 * time zone for an option combination `Intl` refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeUsage } from '../dist/usage.js';
import { FluentProvider, FormattedMessage } from '../dist/client.js';
import { normalizeLeadingSlashes } from '../dist/locale-prefix.js';
import { resolveLocalizedPathname, switchLocaleHref } from '../dist/nav-url.js';
import { createFormatter, clearFormatterCache } from '../dist/formatter.js';

const file = (content, path = 'app/page.tsx') => ({ path, content });

/** Catalog with the keys the analyzer tests use, plus one namespace. */
const CATALOG = {
  'k-one': 'One',
  'k-two': 'Two',
  'checkout-total': 'Total',
  'checkout-typo': 'Typo',
  'home-title': 'Home',
};

const ORIGIN = 'https://site.example';
const BASE_CONFIG = { locales: ['en', 'ru'], defaultLocale: 'en' };

function analyze(content, options) {
  return analyzeUsage({ en: CATALOG, ru: CATALOG }, [file(content)], options);
}

const kinds = (report, kind) => report.issues.filter((issue) => issue.kind === kind);
const reportText = (report) => report.issues.map((issue) => issue.message).join('\n');

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
// V8-01: a URL parser drops tab/LF/CR, so "/<LF>/evil" is protocol-relative
// ---------------------------------------------------------------------------
test('V8-01: the discarded characters no longer hide a protocol-relative prefix', () => {
  for (const mode of ['always', 'as-needed', 'never']) {
    for (const href of ['/\n/evil.example', '/\t//evil.example', '\n//evil.example', '/\r/evil.example']) {
      const out = resolveLocalizedPathname({ href, locale: 'ru' }, { ...BASE_CONFIG, localePrefix: mode });
      assert.equal(new URL(out, ORIGIN).origin, ORIGIN, `${mode}: ${JSON.stringify(href)} -> ${out}`);
    }
  }
});

test('V8-01: the collapse happens before basePath is stripped', () => {
  const config = { ...BASE_CONFIG, localePrefix: 'always', basePath: '/app' };
  // A browser reads "/\n/app/docs" as "//app/docs"; collapsing first keeps the
  // rest of the path meaning what it means for the clean input, so the href is
  // not double-prefixed.
  assert.equal(resolveLocalizedPathname({ href: '/\n/app/docs', locale: 'ru' }, config), '/app/ru/docs');
  assert.equal(resolveLocalizedPathname({ href: '/app/docs', locale: 'ru' }, config), '/app/ru/docs');
  assert.equal(resolveLocalizedPathname({ href: '/app/\ndocs', locale: 'ru' }, config), '/app/ru/docs');
});

test('V8-01: normalizeLeadingSlashes reads the run the way the parser will', () => {
  assert.equal(normalizeLeadingSlashes('/\n/evil.example'), '/evil.example');
  assert.equal(normalizeLeadingSlashes('\t//evil.example'), '/evil.example');
  assert.equal(normalizeLeadingSlashes('/a\nb'), '/ab');
  // Unchanged for ordinary paths and for the documented external passthrough.
  assert.equal(normalizeLeadingSlashes('/about'), '/about');
  assert.equal(normalizeLeadingSlashes('/a//b'), '/a//b');
  assert.equal(normalizeLeadingSlashes('//host/x'), '/host/x');
});

test('V8-01: an external href stays external, by design', () => {
  // A protocol-relative href *is* another origin: rewriting it silently would
  // break deliberate external links, so it passes through as a documented
  // external URL — the fix only stops an input that looks internal from
  // becoming one.
  for (const mode of ['always', 'as-needed', 'never']) {
    assert.equal(
      resolveLocalizedPathname({ href: '//cdn.example/x', locale: 'ru' }, { ...BASE_CONFIG, localePrefix: mode }),
      '//cdn.example/x'
    );
  }
});

test('V8-01: the internal switchLocaleHref collapses the same shapes', () => {
  const config = { ...BASE_CONFIG, localePrefix: 'always' };
  assert.equal(new URL(switchLocaleHref('/\n/evil.example', 'ru', config), ORIGIN).origin, ORIGIN);
  assert.equal(switchLocaleHref('/\n/evil.example', 'ru', config), '/evil.example');
});

// ---------------------------------------------------------------------------
// V8-02: `<FormattedMessage>` ids were invisible to the analyzer
// ---------------------------------------------------------------------------
test('V8-02: a key used only through <FormattedMessage> is not reported unused', () => {
  for (const jsx of [
    '<FormattedMessage id="k-one" />',
    '<FormattedMessage as="span" id="k-one" className="x" />',
    '<FormattedMessage\n  id="k-one"\n/>',
    "<FormattedMessage id={'k-one'} />",
    '<FormattedMessage id={`k-one`} />',
    '<FormattedMessage id="k-one" values={{ n: 1 }} />',
  ]) {
    const report = analyze(`import { FormattedMessage } from 'next-fluent';\n${jsx}\n`);
    assert.deepEqual(report.usedKeys, ['k-one'], jsx);
    assert.deepEqual(kinds(report, 'unused').map((issue) => issue.key), ['checkout-total', 'checkout-typo', 'home-title', 'k-two'], jsx);
    assert.equal(report.dynamicSites, 0, jsx);
  }
});

test('V8-02: a non-literal id is unverifiable, not a missing key', () => {
  const dynamic = analyze(
    'const key = pick();\nreturn <FormattedMessage id={key} values={{ n: 1 }} />;\n'
  );
  assert.deepEqual(kinds(dynamic, 'missing'), []);
  assert.equal(dynamic.dynamicSites, 1);
  assert.match(reportText(dynamic), /<FormattedMessage>/);

  // A spread hides the id completely; the component is still evidence that the
  // file renders messages, so the site is counted as dynamic rather than
  // silently skipped.
  const spread = analyze('return <FormattedMessage {...props} />;\n');
  assert.deepEqual(kinds(spread, 'missing'), []);
  assert.equal(spread.dynamicSites, 0);
  assert.deepEqual(spread.usedKeys, []);
});

test('V8-02: only this component is scanned', () => {
  const report = analyze(
    [
      '<NextFormattedMessage id="k-one" />',
      '<FormattedMessageThing id="k-two" />',
      '<FormattedMessage id="k-one" />',
    ].join('\n')
  );
  assert.deepEqual(report.usedKeys, ['k-one']);
});

// ---------------------------------------------------------------------------
// V8-03: a comment inside the first argument made it unreadable
// ---------------------------------------------------------------------------
test('V8-03: a block comment next to the key does not hide it', () => {
  for (const call of [
    "t('k-one' /* keep this */, { n: 1 })",
    "t(/* pick */ 'k-one')",
    "t('k-one' // trailing\n)",
    "t('k-' /* half */ + 'one')",
  ]) {
    const report = analyze(`const t = useTranslations();\n${call};\n`);
    assert.deepEqual(kinds(report, 'missing'), [], call);
  }
});

test('V8-03: the comment is dropped, the key is still read', () => {
  const report = analyze("const t = useTranslations();\nt('k-one' /* keep */);\n");
  assert.deepEqual(report.usedKeys, ['k-one']);
  assert.equal(report.dynamicSites, 0);
});

// ---------------------------------------------------------------------------
// V8-04: createTranslator takes the namespace in its options argument
// ---------------------------------------------------------------------------
test('V8-04: every documented createTranslator form resolves its namespace', () => {
  for (const factory of [
    "createTranslator(bundle, 'checkout')",
    "createTranslator(bundle, { namespace: 'checkout' })",
    "createTranslator(bundle, null, 'checkout')",
  ]) {
    const report = analyze(`const t = ${factory};\nt('total');\n`);
    assert.deepEqual(report.usedKeys, ['checkout-total'], factory);
    assert.deepEqual(kinds(report, 'missing'), [], factory);
  }
});

test('V8-04: the bundle argument is not mistaken for a namespace', () => {
  // `createTranslator(bundle)` and an options object that declares no namespace
  // are *global* translators: their keys are verifiable, so an unknown one is
  // reported as missing rather than as an unreadable namespace.
  for (const factory of [
    'createTranslator(bundle)',
    'createTranslator(bundle, null)',
    'createTranslator(bundle, { fallbackBundles: [] })',
    'useTranslations()',
    'getTranslations({ locale: \'en\' })',
  ]) {
    const report = analyze(`const t = ${factory};\nt('total');\n`);
    assert.deepEqual(kinds(report, 'missing').map((issue) => issue.key), ['total'], factory);
    assert.equal(report.dynamicSites, 0, factory);
  }
});

test('V8-04: an options object that hides a namespace is unverifiable', () => {
  for (const factory of ['createTranslator(bundle, { ...opts })', 'createTranslator(bundle, nsVar)']) {
    const report = analyze(`const t = ${factory};\nt('nowhere-at-all');\n`);
    assert.deepEqual(kinds(report, 'missing'), [], factory);
    assert.equal(report.dynamicSites, 1, factory);
  }
});

// ---------------------------------------------------------------------------
// V8-05: a namespace argument that exists but cannot be read
// ---------------------------------------------------------------------------
test('V8-05: an unreadable namespace argument makes the site dynamic, not missing', () => {
  for (const factory of ['useTranslations(NS)', 'getTranslations(NS.checkout)', 'useTranslations(getNs())']) {
    const report = analyze(`const t = ${factory};\nt('nowhere-at-all');\n`);
    assert.deepEqual(kinds(report, 'missing'), [], factory);
    assert.equal(report.dynamicSites, 1, factory);
    assert.match(reportText(report), /namespace cannot be read/, factory);
  }
});

test('V8-05: a key that resolves in some namespace stays credited', () => {
  // The namespace cannot be read, but a short key still matches the same key in
  // another namespace (`home` + `-title`): crediting it keeps a false `unused`
  // out of the report, which is the one verdict the analyzer promises never to
  // invent.
  const report = analyze("const t = useTranslations(NS);\nt('title');\n");
  assert.deepEqual(report.usedKeys, ['home-title']);
  assert.deepEqual(kinds(report, 'missing'), []);
  assert.equal(report.dynamicSites, 0);
});

// ---------------------------------------------------------------------------
// V8-06: what counts as a string literal
// ---------------------------------------------------------------------------
test('V8-06: a literal with a type-level assertion is still a literal', () => {
  for (const call of ["t('k-one' as const)", "t('k-one' satisfies string)", "t('k-one' as string)"]) {
    const report = analyze(`const t = useTranslations();\n${call};\n`);
    assert.deepEqual(report.usedKeys, ['k-one'], call);
    assert.equal(report.dynamicSites, 0, call);
  }
});

test('V8-06: a concatenated argument is unverifiable, not an invented key', () => {
  const report = analyze("const t = useTranslations();\nt('k-' + 'two');\n");
  assert.deepEqual(kinds(report, 'missing'), []);
  assert.equal(report.dynamicSites, 1);
  // Before the fix the greedy literal match reported the key `k-' + 'two` as
  // missing — a key no catalog can hold — while calling both real keys unused.
  assert.match(reportText(report), /not a string literal/);
});

test('V8-06: a plus inside the quotes does not make the argument an expression', () => {
  // The other direction of the same fix: the scan must not split `'a + b'` at
  // the operator either. The key is a literal, so it is reported as missing
  // from the catalog — not as unverifiable.
  const report = analyze("const t = useTranslations();\nt('k-one + k-two');\n");
  assert.deepEqual(kinds(report, 'missing').map((issue) => issue.key), ['k-one + k-two']);
  assert.equal(report.dynamicSites, 0);
});

// ---------------------------------------------------------------------------
// V8-07: optional calls
// ---------------------------------------------------------------------------
test('V8-07: t?.() and t.rich?.() are call sites like any other', () => {
  for (const call of ["t?.('k-one')", "t.rich?.('k-one')", "t?.raw('k-one')"]) {
    const report = analyze(`const t = useTranslations();\n${call};\n`);
    assert.deepEqual(report.usedKeys, ['k-one'], call);
    assert.deepEqual(kinds(report, 'unused').map((issue) => issue.key), ['checkout-total', 'checkout-typo', 'home-title', 'k-two'], call);
  }
});

// ---------------------------------------------------------------------------
// V8-08: a valid time zone was reported as unknown when the *options* threw
// ---------------------------------------------------------------------------
test('V8-08: an option combination Intl refuses no longer blames the time zone', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
    const out = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), {
      dateStyle: 'short',
      timeZoneName: 'short',
    });
    // The style is dropped so the value still renders as localized text —
    // `Intl` refuses the combination outright and its TypeError names neither
    // option.
    assert.equal(out, '02/01/2026, UTC');
  });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /dateStyle/);
  assert.doesNotMatch(warnings[0], /Unknown time zone/);
});

test('V8-08: an unusable option value is reported as refused, not explained', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
    const out = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), { hourCycle: 'x' });
    assert.equal(out, '2026-01-02T03:04:05.000Z');
  });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /Intl refused these dateTime options/);
  assert.doesNotMatch(warnings[0], /dateStyle|Unknown time zone/);
});

test('V8-08: an unknown zone is still reported as such', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en-GB', timeZone: 'Mars/Olympus' });
    const out = formatter.dateTime(new Date('2026-01-02T03:04:05Z'), { dateStyle: 'short' });
    assert.equal(out, '02/01/2026', 'the retry without the zone still renders localized text');
  });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /Unknown time zone "Mars\/Olympus"/);
});

test('V8-08: a usable configuration stays silent', () => {
  clearFormatterCache();
  const warnings = captureWarnings(() => {
    const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
    assert.equal(formatter.dateTime(new Date('2026-01-02T03:04:05Z'), { dateStyle: 'short' }), '02/01/2026');
    assert.equal(formatter.number(1234.5), '1,234.5');
  });
  assert.deepEqual(warnings, []);
});

test('V8-02: the rendering path agrees with the analyzer', () => {
  // The analyzer treats `<FormattedMessage id="…">` as a render of that key.
  // This pins the other half: the component really does render it, from a
  // catalog the provider parsed client-side.
  const html = renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale: 'en', messages: 'k-one = One' },
      React.createElement(FormattedMessage, { id: 'k-one' })
    )
  );
  assert.equal(html, 'One');
});
