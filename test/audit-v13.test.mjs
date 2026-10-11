/**
 * Audit pass 13 — see ENGINEERING_AUDIT_V13.md.
 *
 * The last big tail: `src/usage.ts` is the densest module in the library, and
 * it is the one whose mistakes are silent. A hand-written masker that misreads
 * one string or regular expression does not crash — it reports a message that
 * is in use as dead, and the person reading the report deletes a translation.
 *
 * Every case below was probed by hand first. None of them found a defect; all
 * of them were correct. What was missing is any test at all, on the part of the
 * code where a regression would be invisible. These lock the behaviour in.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeUsage } from '../dist/usage.js';

/** Wraps call sites in a component that creates its own translator. */
function component(...body) {
  return [
    "import { useTranslations } from 'next-fluent/client';",
    'export default function C() {',
    '  const t = useTranslations();',
    ...body,
    '}',
  ].join('\n');
}

/** Runs the analyzer over one source file and returns its report. */
function analyze(catalog, source, options) {
  return analyzeUsage({ en: catalog }, [{ path: 'app/page.tsx', content: source }], options);
}

/** Keys the report considers used. */
function used(catalog, source) {
  return [...analyze(catalog, source).usedKeys];
}

const CATALOG = { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' };

// ---------------------------------------------------------------------------
// The masker
// ---------------------------------------------------------------------------
// Every case renders one key that must be found behind something awkward, so a
// masking mistake shows up as a key that silently disappears.

test('an escaped quote does not end the string early', () => {
  // `t('it\\'s')` would be read as `t('it')` followed by a dangling `s')`
  // if the escape were not honoured, and everything after it would be masked.
  assert.deepEqual(used(CATALOG, component("  const s = 'it\\'s fine';", "  return t('alpha');")), [
    'alpha',
  ]);
  assert.deepEqual(used(CATALOG, component("  return t('alpha'); // it\\'s fine")), ['alpha']);
});

test('an escaped backslash does not swallow the rest of the line', () => {
  assert.deepEqual(used(CATALOG, component("  const p = 'a\\\\b';", "  return t('alpha');")), [
    'alpha',
  ]);
});

test('a regular expression whose body contains a quote masks nothing after it', () => {
  // The classic killer: if `'` inside `/['"]+/g` opened a string, everything
  // after it on the file would be masked and every key would look unused.
  assert.deepEqual(used(CATALOG, component("  const r = /['\"]+/g;", "  return t('alpha');")), [
    'alpha',
  ]);
  assert.deepEqual(
    used(CATALOG, component("  const r = /['\"]+/g;", "  return t('alpha'), t('beta');")),
    ['alpha', 'beta']
  );
});

test('regular expressions with flags, escaped slashes and slashes in a class', () => {
  assert.deepEqual(used(CATALOG, component('  const r = /ab+/gi;', "  return t('alpha');")), ['alpha']);
  assert.deepEqual(used(CATALOG, component('  const r = /a\\/b/g;', "  return t('alpha');")), [
    'alpha',
  ]);
  assert.deepEqual(used(CATALOG, component('  const r = /[/]/g;', "  return t('alpha');")), ['alpha']);
  assert.deepEqual(
    used(CATALOG, component("  const r = /[\\\\]'/g;", "  return t('alpha');")),
    ['alpha']
  );
});

test('a division is not mistaken for a regular expression', () => {
  assert.deepEqual(used(CATALOG, component('  const x = a / b;', "  return t('alpha');")), ['alpha']);
});

test('a regular expression after a keyword is still a regular expression', () => {
  assert.deepEqual(
    used(CATALOG, component('  const r = typeof x === "string" ? /y/.test(x) : false;', "  return t('alpha');")),
    ['alpha']
  );
  assert.deepEqual(
    used(CATALOG, component('  function f() { return /x/.test(y); }', "  return t('alpha');")),
    ['alpha']
  );
});

test('a template literal with an interpolation is not read as a key', () => {
  const report = analyze(CATALOG, component('  return t(`pre-${id}`);'));
  assert.deepEqual([...report.usedKeys], []);
  assert.equal(report.dynamicSites, 1, 'and it is reported as unverifiable, not guessed at');
});

test('braces, calls and quotes inside a template interpolation do not confuse it', () => {
  for (const expression of ['`${fn(\'x\')} key`', '`${ {a: 1}.a }`', "`${a['b']}`", '`${a.b.c}`']) {
    const report = analyze(CATALOG, component(`  return t(${expression});`));
    assert.equal(report.dynamicSites, 1, `${expression} must be reported as unverifiable`);
  }
});

test('a template literal without an interpolation is a key', () => {
  assert.deepEqual(used(CATALOG, component('  return t(`alpha`);')), ['alpha']);
});

test('comments cannot invent a call site', () => {
  // A comment mentioning a call must not keep a dead key alive, and a comment
  // containing an apostrophe must not mask the code after it.
  const report = analyze(
    { alpha: 'Alpha', ghost: 'Ghost' },
    [
      "import { useTranslations } from 'next-fluent/client';",
      "export default function C() {",
      '  const t = useTranslations();',
      "  // it's a note about t('ghost')",
      "  /* t('ghost') */",
      "  return t('alpha');",
      '}',
    ].join('\n')
  );
  assert.deepEqual([...report.usedKeys], ['alpha']);
  assert.ok(
    report.issues.some((issue) => issue.kind === 'unused' && issue.key === 'ghost'),
    'a key mentioned only in comments stays unused'
  );
});

test('a source file with a syntax error still yields what can be read', () => {
  // Half-saved files are what a watcher or a `--usage` run on a dirty tree sees.
  for (const broken of ["  const s = 'oops", '  const s = `oops', '  const r = /oops', '  return t({']) {
    const report = analyze(CATALOG, component("  return t('alpha');", broken));
    assert.deepEqual([...report.usedKeys], ['alpha'], `after ${JSON.stringify(broken)}`);
  }
});

// ---------------------------------------------------------------------------
// What the report says about a call site
// ---------------------------------------------------------------------------

test('a literal that is not in the catalog is missing, not dynamic', () => {
  const report = analyze(CATALOG, component("  return t('ghost');"));
  const missing = report.issues.filter((issue) => issue.kind === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].key, 'ghost');
  assert.equal(report.dynamicSites, 0);
});

test('an expression is dynamic, whatever shape it takes', () => {
  for (const expression of ['key', "'pre-' + id", '`pre-${id}`', 'cond ? a : b', 'keys[i]']) {
    const report = analyze(CATALOG, component(`  return t(${expression});`));
    assert.equal(report.dynamicSites, 1, `${expression} must be unverifiable`);
  }
});

test('a translator this file does not create is reported, not guessed', () => {
  // A component that receives `t` as a prop: the namespace cannot be read, so
  // a literal key is listed for review instead of being resolved blindly — and
  // claiming it was missing would fail a build over a call we cannot attribute.
  const report = analyze(CATALOG, "export default function Row({ t }) {\n  return t('alpha');\n}\n");
  assert.deepEqual([...report.usedKeys], ['alpha'], 'a key that matches counts as rendered');
  assert.deepEqual(
    report.issues.filter((issue) => issue.key === 'alpha'),
    [],
    'whatever matched, nothing is claimed about it'
  );

  // A literal that matches nothing is *not* reported as missing either: the
  // namespace is unknown, so a real key in another namespace could be the one
  // that was meant.
  const unmatched = analyze(
    CATALOG,
    "export default function Row({ t }) {\n  return t('ghost');\n}\n"
  );
  assert.deepEqual([...unmatched.usedKeys], []);
  assert.deepEqual(unmatched.issues.filter((issue) => issue.kind === 'missing'), []);
  const dynamic = unmatched.issues.filter((issue) => issue.kind === 'dynamic');
  assert.equal(dynamic.length, 1);
  assert.match(dynamic[0].message, /translator this file does not create/);
});

test('a non-literal key is listed only where the translator is known', () => {
  // The boundary, stated as a test because the README has to state it too:
  //
  //   known translator -> listed as `dynamic`, since the key cannot be read;
  //   unknown name    -> left alone, because `t` may not be a translator.
  //
  // The second half is what keeps `const t = 5; t(3)` out of the report; it is
  // also why a component that takes `t` from props contributes nothing here.
  const known = analyze(CATALOG, [
    "import { useTranslations } from 'next-fluent/client';",
    'export function A() {',
    '  const t = useTranslations();',
    "  return t('alpha');",
    '}',
    'export function Row({ t, row }) {',
    '  return <span>{t(row.key)}</span>;',
    '}',
  ].join('\n'));
  assert.deepEqual([...known.usedKeys], ['alpha']);
  assert.equal(known.dynamicSites, 1, 'the expression call after a known binding is listed');

  const unknown = analyze(CATALOG, 'export function Row({ t, row }) { return t(row.key); }\n');
  assert.equal(unknown.dynamicSites, 0);
  assert.deepEqual(unknown.issues.filter((issue) => issue.kind === 'dynamic'), []);
});

test('t.attrs() resolves a message that has only attributes', () => {
  const catalog = 'only-attrs =\n    .placeholder = Name\nfull = Hello\n    .aria = Label\n';
  const report = analyze(catalog, component("  return JSON.stringify([t.attrs('only-attrs')]);"));
  assert.deepEqual([...report.usedKeys], ['only-attrs', 'only-attrs.placeholder']);
  assert.deepEqual(
    report.issues.filter((issue) => issue.key === 'only-attrs'),
    [],
    'a message with only attributes still counts as rendered by t.attrs()'
  );
});

test('an analysis with no catalogs is empty rather than broken', () => {
  const empty = analyzeUsage({}, []);
  assert.deepEqual(empty.catalogKeys, []);
  assert.deepEqual(empty.usedKeys, []);
  assert.deepEqual(empty.issues, []);
  assert.equal(empty.referenceLocale, '');

  // A literal call site is still reviewable with nothing to match it against.
  const withSource = analyzeUsage({}, [{ path: 'app/p.tsx', content: "t('x')" }]);
  assert.equal(withSource.dynamicSites, 1);
});

test('a reference locale outside the analyzed catalogs is refused by name', () => {
  assert.throws(
    () => analyzeUsage({ en: CATALOG }, [], { referenceLocale: 'ru' }),
    /Reference locale "ru" is not part of the analyzed catalogs \(en\)/
  );
});

// ---------------------------------------------------------------------------
// The catalog is read from disk like a real project
// ---------------------------------------------------------------------------

test('an unparsable source file does not take the analysis down', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-usage-'));
  try {
    const file = path.join(dir, 'page.tsx');
    fs.writeFileSync(file, "const t = 'x'; t('alpha');", 'utf8');
    const report = analyzeUsage({ en: CATALOG }, [{ path: file, content: fs.readFileSync(file, 'utf8') }]);
    assert.deepEqual([...report.usedKeys], ['alpha']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// The two CLI commands behind `--usage`
// ---------------------------------------------------------------------------

test('checking no catalogs at all is an empty report, not a failure', async () => {
  const { checkCatalogs } = await import('../dist/check.js');
  assert.deepEqual(checkCatalogs({}), {
    referenceLocale: '',
    locales: [],
    issues: [],
    keyCount: 0,
  });
});

test('pseudo-localization reaches past a trailing variable', async () => {
  const { pseudoLocalizeFtl } = await import('../dist/pseudo.js');
  // The pattern ends with a placeable, so the closing marker has to become a
  // text element of its own instead of being appended to the last one.
  const out = pseudoLocalizeFtl('greet = Hello { $name }\n');
  // The closing marker lands after the placeable, as its own text element.
  assert.match(out, /^greet = \[.*\{ \$name \}\]$/m);
  // A message that is nothing but a variable has no text to transform.
  assert.equal(pseudoLocalizeFtl('greet = { $name }\n'), 'greet = { $name }\n');
  // Attributes are transformed the same way as values.
  assert.match(pseudoLocalizeFtl('greet =\n    .label = Save now\n'), /\.label = \[.*\]/);
});

test('a broken catalog is reported once per distinct source', async () => {
  const { warnAboutDroppedEntries } = await import('../dist/catalog-integrity.js');
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const source = 'ok = Fine\nbroken = {\n';
    warnAboutDroppedEntries('en', source);
    warnAboutDroppedEntries('en', source);
    warnAboutDroppedEntries('en', source);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1, 'a list render cannot turn into a warning per row');
  assert.match(warnings[0], /contains 1 entry the Fluent parser cannot read/);
  assert.match(warnings[0], /"broken"/);
  assert.match(warnings[0], /next-fluent check/, 'and says how to see the whole report');
});

test('the warn-once memory is bounded', async () => {
  const { warnAboutDroppedEntries } = await import('../dist/catalog-integrity.js');
  const original = console.warn;
  let count = 0;
  console.warn = () => {
    count++;
  };
  try {
    // Distinct broken catalogs; past the cap the set resets itself rather than
    // growing without bound in a long-running server.
    for (let index = 0; index < 260; index++) {
      warnAboutDroppedEntries('en', `ok = Fine\nbroken${index} = {\n`);
    }
  } finally {
    console.warn = original;
  }
  assert.equal(count, 260, 'every distinct catalog is reported exactly once');
});
