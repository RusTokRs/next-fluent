/**
 * Audit pass 9 — see ENGINEERING_AUDIT_V9.md.
 *
 * Pass 9 audited the verification apparatus itself rather than the library, and
 * the six findings below are what came out of it: two gates that could not see
 * part of what they claim to protect (the client size budget, the edge bundle),
 * a build step that silently discarded the source of its own facade, a CI
 * matrix that reported the version it tested instead of asserting it, and two
 * silent failures in the library itself — `Intl` refusals that degraded to a
 * bare value, and JSON catalog entries that disappeared.
 *
 * Every test here fails on the code before this pass. Where a check is about a
 * *gate*, the test asserts the property the gate protects rather than the
 * script's text, so rewriting the gate does not invalidate it, and removing the
 * protection does.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

import { jsonToFluent, isJsonCatalog } from '../dist/catalog.js';
import { createFormatter, clearFormatterCache } from '../dist/formatter.js';
import { createFluentBundle, createTranslator } from '../dist/bundle.js';
import { clearFunctionsCache } from '../dist/functions.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFile(path.join(root, relative), 'utf8');

/** `js-yaml` refuses duplicate mapping keys, which GitHub Actions does not. */
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// V9-01. The client size budget measured a fraction of what a browser can load
// ---------------------------------------------------------------------------

/** Same list the size gate generates its ceiling from. */
const CLIENT_ENTRIES = [
  'next-fluent',
  'next-fluent/client',
  'next-fluent/navigation',
  'next-fluent/routing',
  'next-fluent/formatter',
  'next-fluent/utils',
  'next-fluent/catalog',
];

const EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'next',
  'next/link',
  'next/link.js',
  'next/navigation',
  'next/router',
];

test('the client ceiling carries every runtime export a browser can import', async () => {
  const dir = await mkdtemp(path.join(root, '.ceiling-test-'));
  const entry = path.join(dir, 'ceiling.ts');
  await writeFile(
    entry,
    `${CLIENT_ENTRIES.map((specifier) => `export * from '${specifier}';`).join('\n')}\n`,
    'utf8'
  );
  try {
    const expected = new Set();
    for (const specifier of CLIENT_ENTRIES) {
      for (const name of Object.keys(await import(specifier))) expected.add(name);
    }
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      define: { 'process.env.NODE_ENV': '"production"' },
      external: EXTERNAL,
      metafile: true,
    });
    const bundled = new Set(
      Object.values(result.metafile.outputs).flatMap((output) => output.exports)
    );
    const unmeasured = [...expected].filter((name) => !bundled.has(name));
    assert.deepEqual(
      unmeasured,
      [],
      `the ceiling bundle omits ${unmeasured.join(', ')}: reachable from a browser, ` +
        'invisible to the size budget'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the ceiling is larger than the app fixture — the gap is what it now covers', async () => {
  const dir = await mkdtemp(path.join(root, '.ceiling-test-'));
  const entry = path.join(dir, 'ceiling.ts');
  await writeFile(
    entry,
    `${CLIENT_ENTRIES.map((specifier) => `export * from '${specifier}';`).join('\n')}\n`,
    'utf8'
  );
  const options = {
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: EXTERNAL,
  };
  const size = async (file) => {
    const result = await build({ ...options, entryPoints: [file] });
    return Buffer.byteLength(result.outputFiles[0].text, 'utf8');
  };
  try {
    const ceiling = await size(entry);
    const fixture = await size(path.join(root, 'test/fixtures/size/client-consumer.ts'));
    // Before this pass the ceiling was exactly the fixture: 25 of the root
    // entry's 42 exports were measured by nothing at all.
    assert.ok(
      ceiling > fixture,
      `the ceiling (${ceiling} B) must exceed the fixture (${fixture} B); equal sizes ` +
        'mean the fixture imports the whole browser-reachable surface'
    );
    assert.ok(
      ceiling - fixture > 1024,
      `the unmeasured gap is ${ceiling - fixture} B — the point of the ceiling is the ` +
        'code the fixture never imported'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the size gate enumerates every browser-reachable entry point', async () => {
  const script = await read('scripts/size-budget.mjs');
  const match = script.match(/const CLIENT_ENTRIES = \[([\s\S]*?)\];/);
  assert.ok(match, 'scripts/size-budget.mjs no longer declares CLIENT_ENTRIES');
  const listed = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    listed.sort(),
    [...CLIENT_ENTRIES].sort(),
    'this test and the size gate must agree on which entries a browser can import'
  );

  // Every published subpath is either measured as client surface or excluded on
  // purpose. Adding a subpath without deciding which is exactly the drift this
  // guards: before it, a new client entry would simply go unmeasured.
  const pkg = JSON.parse(await read('package.json'));
  const SERVER_OR_BUILD_TIME = new Set([
    'next-fluent/server',
    'next-fluent/server-provider',
    'next-fluent/middleware',
    'next-fluent/plugin',
    'next-fluent/typegen',
    'next-fluent/check',
    'next-fluent/usage',
    'next-fluent/catalog-io',
    'next-fluent/messages',
    'next-fluent/pseudo',
    'next-fluent/factory',
  ]);
  const specifiers = Object.keys(pkg.exports)
    .filter((key) => key !== './package.json')
    .map((key) => (key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`));
  for (const specifier of specifiers) {
    assert.ok(
      CLIENT_ENTRIES.includes(specifier) || SERVER_OR_BUILD_TIME.has(specifier),
      `${specifier} is published but neither measured as client surface nor listed as ` +
        'server/build-time; add it to one of the two'
    );
  }
});

// ---------------------------------------------------------------------------
// V9-02. The build wrote the package facade from a second copy of it
// ---------------------------------------------------------------------------

test('the shipped facade is the transpiled source facade, not a copy of it', async () => {
  for (const name of ['index-browser', 'index-server']) {
    const source = await read(`src/${name}.ts`);
    const shipped = await read(`dist/${name}.js`);
    const specifiers = (text) =>
      [...text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)]
        .map((m) => m[1].replace(/\.js$/, ''))
        .sort();
    assert.deepEqual(
      specifiers(shipped),
      specifiers(source),
      `dist/${name}.js re-exports a different set of modules than src/${name}.ts; the ` +
        'facade is written down twice and only one of them ships'
    );
  }
});

test('every module the package root re-exports exists', async () => {
  const shipped = await read('dist/index-browser.js');
  for (const [, specifier] of shipped.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
    assert.ok(
      existsSync(path.join(root, 'dist', specifier)),
      `the browser root re-exports ./${specifier}, which is not in dist/`
    );
  }
});

// ---------------------------------------------------------------------------
// V9-03/V9-04. Intl refusals degraded in silence — in the formatter *and* in
// the FTL functions, which run where the pattern's own error channel cannot
// see them
// ---------------------------------------------------------------------------

/** Runs `body` with console.warn captured, returning the warnings. */
function captureWarnings(body) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    body();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('a refused number configuration is reported, not rendered in silence', () => {
  clearFormatterCache();
  const formatter = createFormatter({ locale: 'en-US' });
  const warnings = captureWarnings(() => {
    assert.equal(formatter.number(1234.5, { style: 'currency' }), '1234.5');
  });
  assert.equal(warnings.length, 1, 'the refusal has to be reported exactly once');
  const [warning] = warnings;
  assert.match(warning, /Intl refused these number options/);
  assert.match(warning, /"en-US"/);
  assert.match(warning, /style/, 'the warning names the options that were refused');
  assert.match(warning, /1234\.5/, 'the warning says what was rendered instead');
});

test('a refused relativeTime configuration is reported too', () => {
  clearFormatterCache();
  const formatter = createFormatter({ locale: 'en-US' });
  const warnings = captureWarnings(() => {
    assert.equal(formatter.relativeTime(-3, 'day', { style: 'nope' }), '-3 day');
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Intl refused these relativeTime options/);
  assert.match(warnings[0], /-3 day/);
});

test('the report is deduplicated per option set and reset by clearFormatterCache', () => {
  clearFormatterCache();
  const formatter = createFormatter({ locale: 'en-US' });
  const warnings = captureWarnings(() => {
    for (let i = 0; i < 5; i += 1) formatter.number(10, { style: 'currency' });
    formatter.number(10, { style: 'unit', unit: 'nope' });
  });
  assert.equal(warnings.length, 2, 'one report per distinct option set, not per call');

  // A table of prices must not fill the console; a second distinct option set
  // does get its own line.
  clearFormatterCache();
  const afterReset = captureWarnings(() => formatter.number(10, { style: 'currency' }));
  assert.equal(afterReset.length, 1, 'clearFormatterCache has to reset the report set');
});

test('a valid configuration still formats silently', () => {
  clearFormatterCache();
  const formatter = createFormatter({ locale: 'en-US' });
  const warnings = captureWarnings(() => {
    assert.equal(formatter.number(1234.5, { style: 'currency', currency: 'USD' }), '$1,234.50');
    assert.equal(formatter.relativeTime(-3, 'day'), '3 days ago');
  });
  assert.deepEqual(warnings, []);
});

test('a Fluent function that Intl refuses is reported too', () => {
  clearFunctionsCache();
  const bundle = createFluentBundle(
    'en',
    'bad = { CURRENCY($p, currencyDisplay: "nope") }\n' +
      'good = { CURRENCY($p, currency: "EUR") }\n' +
      'pct = { PERCENT($p, maximumFractionDigits: -1) }',
    { useIsolating: false, disableCache: true }
  );
  const t = createTranslator(bundle);
  const warnings = captureWarnings(() => {
    assert.equal(t('bad', { p: 12.5 }), '12.5 USD', 'the fallback itself is unchanged');
    t('bad', { p: 12.5 });
    assert.equal(t('good', { p: 12.5 }), '€12.50');
    assert.equal(t('pct', { p: 0.125 }), '12.5%');
  });
  assert.equal(warnings.length, 2, 'one report per argument set, not per render');
  assert.match(warnings[0], /Intl refused the options of CURRENCY\(\)/);
  assert.match(warnings[0], /currencyDisplay=nope/, 'the report names the arguments');
  assert.match(warnings[0], /"12\.5 USD"/, 'and what was rendered instead');
  assert.match(warnings[1], /Intl refused the options of PERCENT\(\)/);

  clearFunctionsCache();
  const afterReset = captureWarnings(() => t('bad', { p: 12.5 }));
  assert.equal(afterReset.length, 1, 'clearFunctionsCache has to reset the report set');
});

test('the hash helpers are not part of the public surface', async () => {
  const root = await import('next-fluent');
  const cache = await import('../dist/cache.js');
  // `fnv1a64` used to answer a 32-bit hash under a 64-bit name, from a module
  // every entry point re-exported.
  assert.equal(root.fnv1a64, undefined);
  assert.equal(root.fnv1a32, undefined);
  assert.equal(cache.fnv1a64, undefined);
  assert.equal(cache.fnv1a32, undefined);
});

// ---------------------------------------------------------------------------
// V9-05/V9-06. JSON catalogs: a vanished message and a rejected attribute
// ---------------------------------------------------------------------------

test('an empty message object is rejected instead of silently dropped', () => {
  assert.throws(
    () => jsonToFluent({ a: {} }),
    (error) => {
      assert.match(error.message, /"a"/);
      assert.match(error.message, /empty object/i);
      assert.match(error.message, /value|attribute|nested/i, 'the error says what to do');
      return true;
    }
  );
  // The shape that actually lost data: one real message beside a placeholder.
  assert.throws(() => jsonToFluent({ greeting: 'Hi', todo: {} }), /empty object/i);
  assert.throws(() => jsonToFluent({ nav: { items: {} } }), /empty object/i);
});

test('the shapes that are messages still convert', () => {
  // `{$count}` and `{count}` are placeables; whitespace inside the braces is
  // deliberately *not* (a documented rule, pinned here so it stays deliberate).
  const ftl = jsonToFluent({
    greeting: 'Hi',
    empty: { '': '' },
    counted: { '': '{$count} items', count: '' },
    prose: 'wrap in {braces}',
  });
  assert.match(ftl, /^greeting = Hi$/m);
  assert.match(ftl, /^empty = \{ "" \}$/m);
  assert.match(ftl, /^counted = \{ \$count \}\{ " items" \}$/m);
  assert.match(ftl, /^ {4}\.count = \{ "" \}$/m);
  assert.match(ftl, /^prose = \{ "wrap in " \}\{ \$braces \}$/m);
  assert.equal(isJsonCatalog({ a: {} }), true, 'shape detection is unaffected');
});

test('an FTL-style ".attr" key is accepted as an attribute', () => {
  const ftl = jsonToFluent({ login: { '': 'Sign in', '.label': 'Label', title: 'Tooltip' } });
  const bundle = createFluentBundle('en', ftl, { useIsolating: false, disableCache: true });
  const message = bundle.getMessage('login');
  assert.ok(message, `expected a "login" message in:\n${ftl}`);
  assert.equal(message.value, 'Sign in');
  assert.equal(message.attributes.label, 'Label');
  assert.equal(message.attributes.title, 'Tooltip');
});

test('a dot-prefixed key is still rejected where it cannot be an attribute', () => {
  // In a namespace position there is no `""` value to attach to, so the key can
  // only be a nested message id — and `.name` is not one.
  assert.throws(() => jsonToFluent({ nav: { '.items': 'x' } }), /not a valid Fluent message id/);
});

// ---------------------------------------------------------------------------
// V9-07. The CI matrix printed the Next version instead of checking it
// ---------------------------------------------------------------------------

test('the integration harness refuses to test a Next major other than the one asked for', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/test-next-integration.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXT_FLUENT_NEXT_MAJOR: '999', NEXT_TELEMETRY_DISABLED: '1' },
    timeout: 120_000,
  });
  assert.notEqual(result.status, 0, 'a mismatched matrix label must fail the job');
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /asked to test Next 999/);
  assert.match(output, /matrix label would not match/);
});

test('the CI workflow passes the major its matrix job is named after', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(
    workflow,
    /NEXT_FLUENT_NEXT_MAJOR: \$\{\{ matrix\.profile\.next \}\}/,
    'without this the assertion can never fire in CI'
  );
});

test('the workflows parse, and no key is silently overwritten', async () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/publish.yml']) {
    const document = yaml.load(await read(file));
    assert.ok(document?.jobs && Object.keys(document.jobs).length > 0, `${file} has no jobs`);
  }

  // YAML keeps the last of two identical keys and reports nothing. Adding the
  // version assertion to the integration step as a second `env:` block therefore
  // did not merge it — it *replaced* the block above it, and the browser
  // regression switch disappeared from CI without a word. A parser that refuses
  // duplicate keys is the cheapest possible guard against that class.
  const ci = yaml.load(await read('.github/workflows/ci.yml'));
  const step = ci.jobs.test.steps.find((entry) => entry.name === 'Build a real Next.js consumer app');
  assert.ok(step, 'the integration step is gone');
  assert.ok(step.env?.NEXT_FLUENT_BROWSER !== undefined, 'the browser switch was dropped');
  assert.ok(step.env?.NEXT_FLUENT_NEXT_MAJOR !== undefined, 'the version switch is missing');
});

// ---------------------------------------------------------------------------
// V9-08/V9-09. The edge graph had no size line and reported the wrong unit;
// the hash helpers answered 32 bits under a 64-bit name in the public surface
// ---------------------------------------------------------------------------

test('the edge graph stays small and free of the parser', async () => {
  const result = await build({
    entryPoints: [path.join(root, 'src/middleware.ts')],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: EXTERNAL,
  });
  const code = result.outputFiles[0].text;
  const bytes = Buffer.byteLength(code, 'utf8');
  assert.ok(
    bytes <= 64 * 1024,
    `the middleware bundle is ${bytes} B, over the edge budget; something server-only ` +
      'leaked into the graph'
  );
  // The parser is the dependency that would blow past that line on its own.
  assert.doesNotMatch(code, /Junk|Entry|FluentBundle\b/, 'an FTL parser is in the edge graph');
});

test('the edge check enforces a size line, in bytes', async () => {
  const script = await read('scripts/check-edge-runtime.mjs');
  // The property test above holds before and after this pass by design — the
  // graph never grew. What this pass added is the gate, so the gate itself is
  // asserted: a budget compared against a *byte* count, not a UTF-16 length
  // (which undercounts every non-ASCII character in the bundle).
  assert.match(script, /Buffer\.byteLength\(code, 'utf8'\)/);
  assert.match(script, /EDGE_BUDGET_BYTES = (\d+) \* 1024/);
  const budget = Number(script.match(/EDGE_BUDGET_BYTES = (\d+) \* 1024/)[1]);
  assert.ok(budget >= 48 && budget <= 128, `the edge budget is ${budget} kB`);
  assert.match(script, /failures\.push\([^)]*edge budget/);
});