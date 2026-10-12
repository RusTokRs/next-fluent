/**
 * Audit pass 24 — see ENGINEERING_AUDIT_V24.md.
 *
 * `cache.js` reported 100% of its lines but 88.89% of its functions. That
 * combination is a fingerprint: a function whose body sits on the same line as
 * its declaration, so the line is covered by the declaration and the body never
 * runs. Exactly one function in the module was in that state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeSourceHash, getCachedFluentBundle, clearBundleCache } from '../dist/cache.js';
import { createFluentBundle, createTranslator } from '../dist/bundle.js';

// ---------------------------------------------------------------------------
// V24-01: a multi-file catalog is cached like any other
// ---------------------------------------------------------------------------

test('V24-01: the same array of sources hits the cache instead of rebuilding', () => {
  clearBundleCache();
  const sources = [`arr-${Date.now()} = A\n`, `arr2-${Date.now()} = B\n`];

  const first = getCachedFluentBundle('en', sources, { useIsolating: false });
  const second = getCachedFluentBundle('en', sources, { useIsolating: false });

  // Identity, not equality: a rebuild would return a different FluentBundle.
  assert.equal(first, second, 'an unchanged array source must be served from the cache');

  // And the cached bundle still resolves both parts of the catalog.
  const t = createTranslator(second);
  assert.equal(t(sources[0].split(' ')[0]), 'A');
  assert.equal(t(sources[1].split(' ')[0]), 'B');
});

test('V24-01: a string source and an array source both round-trip through createFluentBundle', () => {
  clearBundleCache();
  const stamp = Date.now();

  const fromString = createFluentBundle('en', `s${stamp} = S\n`, { useIsolating: false });
  assert.equal(createFluentBundle('en', `s${stamp} = S\n`, { useIsolating: false }), fromString);

  const fromArray = createFluentBundle('en', [`a${stamp} = A\n`, `b${stamp} = B\n`], {
    useIsolating: false,
  });
  assert.equal(
    createFluentBundle('en', [`a${stamp} = A\n`, `b${stamp} = B\n`], { useIsolating: false }),
    fromArray,
    'the array form must be cached too, not rebuilt on every request'
  );
});

// ---------------------------------------------------------------------------
// V24-02: the delimiter step in the array hash is load-bearing
// ---------------------------------------------------------------------------

test('V24-02: different splits of the same text do not share a cache entry', () => {
  // `computeSourceHash` folds a separator byte in after every element precisely
  // so that `['ab','c']` and `['a','bc']` — same characters, same total length,
  // same element count — cannot collide. Without the delimiter both would hash
  // identically and a bundle built from one split would be served for the other.
  const left = computeSourceHash(['ab', 'c']);
  const right = computeSourceHash(['a', 'bc']);

  assert.notEqual(left, right, 'array splits of identical content must hash differently');
  assert.equal(left.split(':')[0], '2', 'the element count is part of the hash');
  assert.equal(left.split(':')[1], right.split(':')[1], 'the total length is the same…');
  assert.notEqual(left.split(':')[2], right.split(':')[2], '…so the hash is what separates them');
});

test('V24-02: the same array hashes the same, and order matters', () => {
  const a = ['x = X\n', 'y = Y\n'];
  assert.equal(computeSourceHash(a), computeSourceHash(['x = X\n', 'y = Y\n']));
  assert.notEqual(
    computeSourceHash(a),
    computeSourceHash(['y = Y\n', 'x = X\n']),
    'reordering changes which duplicate definition wins, so it must not hash equal'
  );
  // A string and a one-element array holding it are different shapes and are
  // keyed differently, which keeps their cache entries from being confused.
  assert.notEqual(computeSourceHash('x = X\n'), computeSourceHash(['x = X\n']));
});

test('V24-02: empty and falsy elements do not corrupt the hash', () => {
  const withEmpty = computeSourceHash(['a = A\n', '', 'b = B\n']);
  const without = computeSourceHash(['a = A\n', 'b = B\n']);
  assert.notEqual(withEmpty, without, 'an empty element still counts as an element');
  assert.equal(withEmpty.split(':')[0], '3');
  assert.equal(without.split(':')[0], '2');
});

// ---------------------------------------------------------------------------
// V24-03: clearing the cache really discards it
// ---------------------------------------------------------------------------

test('V24-03: clearBundleCache forces a rebuild', () => {
  const source = `clr-${Date.now()} = C\n`;
  const first = getCachedFluentBundle('en', source, { useIsolating: false });
  assert.equal(getCachedFluentBundle('en', source, { useIsolating: false }), first);

  clearBundleCache();

  const rebuilt = getCachedFluentBundle('en', source, { useIsolating: false });
  assert.notEqual(rebuilt, first, 'a cleared cache must not serve the old bundle');
  assert.equal(createTranslator(rebuilt)(source.split(' ')[0]), 'C');
});

// ---------------------------------------------------------------------------
// V24-04..07: the Next.js plugin — 60% of its functions had never been called
// ---------------------------------------------------------------------------

import { createNextFluentPlugin } from '../dist/plugin.js';

/** Captures both console channels while `body` runs. */
function captureConsole(body) {
  const log = [];
  const error = [];
  const keepLog = console.log;
  const keepError = console.error;
  console.log = (...args) => log.push(args.map(String).join(' '));
  console.error = (...args) => error.push(args.map(String).join(' '));
  try {
    return { result: body(), log, error };
  } finally {
    console.log = keepLog;
    console.error = keepError;
  }
}

function tempCatalog(contents = 'greeting = Hello\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v24-cat-'));
  fs.writeFileSync(path.join(dir, 'en.ftl'), contents);
  return dir;
}

test('V24-04: the plugin binds the request config for both bundlers', () => {
  const apply = createNextFluentPlugin('./src/i18n/request.ts');
  assert.equal(typeof apply, 'function', 'the factory returns the config wrapper');

  const config = apply({});
  assert.equal(typeof config.webpack, 'function');
  assert.equal(config.turbopack.resolveAlias['next-fluent/config'].endsWith('src/i18n/request.ts'), true);

  // A user's own turbopack aliases survive.
  const merged = apply({ turbopack: { resolveAlias: { other: './other.ts' } } });
  assert.equal(merged.turbopack.resolveAlias.other, './other.ts');
  assert.ok(merged.turbopack.resolveAlias['next-fluent/config']);
});

test('V24-05: the webpack hook sets the alias and delegates to the user hook', () => {
  const calls = [];
  const apply = createNextFluentPlugin('./src/i18n/request.ts');

  const plain = apply({});
  const bare = { resolve: {} };
  assert.equal(plain.webpack(bare, {}), bare, 'without a user hook the config comes back');
  assert.ok(bare.resolve.alias['next-fluent/config'], 'the alias is set');

  const withUser = apply({ webpack: (config) => { calls.push(config); return 'user-result'; } });
  const out = withUser.webpack({ resolve: {} }, { isServer: true });
  assert.equal(out, 'user-result', 'the user hook decides the return value');
  assert.equal(calls.length, 1, 'and it receives the already-aliased config');
  assert.ok(calls[0].resolve.alias['next-fluent/config']);
});

test('V24-06: typegen against a catalog directory generates types quietly', () => {
  const dir = tempCatalog();
  const output = path.join(dir, 'next-fluent.d.ts');
  try {
    const apply = createNextFluentPlugin('./src/i18n/request.ts', {
      typegen: { input: dir, output, watch: false },
    });
    const { result, log, error } = captureConsole(() => apply({}));

    assert.deepEqual(error, [], 'a healthy catalog must not log an error');
    assert.ok(fs.existsSync(output), 'the declaration file is written');
    assert.ok(
      log.some((line) => line.includes('Generated message types')),
      `expected a generation notice, got ${JSON.stringify(log)}`
    );
    assert.ok(result.turbopack.resolveAlias['next-fluent/config']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V24-07: typegen pointed at a single file still reports the dead watcher', () => {
  // Measured, not assumed: `writeTypeDeclarations` accepts a file, so generation
  // succeeds — and then `watchCatalogs` gets the same path, finds it is not a
  // directory, and reports through the plugin's `onError`. Without that arrow
  // being wired, the dev watcher would be silently dead.
  const dir = tempCatalog();
  const file = path.join(dir, 'en.ftl');
  const output = path.join(dir, 'next-fluent.d.ts');
  try {
    const apply = createNextFluentPlugin('./src/i18n/request.ts', {
      typegen: { input: file, output, watch: true },
    });
    const { error } = captureConsole(() => apply({}));

    assert.ok(fs.existsSync(output), 'types are still generated from the file');
    assert.ok(
      error.some((line) => /Type generation failed/.test(line) && /not a directory/.test(line)),
      `expected the watcher failure to be reported, got ${JSON.stringify(error)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V24-08: a typegen failure is reported and does not break the config', () => {
  const dir = tempCatalog();
  try {
    const apply = createNextFluentPlugin('./src/i18n/request.ts', {
      // A writable catalog but an output path through a file: reading succeeds,
      // writing cannot. (`__filename` does not exist in an ES module, and an
      // unreadable *input* would not throw at all — `collectCatalogFiles`
      // swallows the readdir error and reports zero files.)
      typegen: { input: dir, output: path.join(dir, 'en.ftl', 'out.d.ts'), watch: false },
    });
    const { result, error } = captureConsole(() => apply({}));

    assert.ok(
      error.some((line) => /Type generation failed/.test(line)),
      `expected the failure to be reported, got ${JSON.stringify(error)}`
    );
    assert.ok(result.turbopack.resolveAlias['next-fluent/config'], 'the config is still returned');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V24-09: the dev watcher regenerates types when a catalog changes', async () => {
  // The last uncalled function in the plugin is its `onUpdate` arrow, and the
  // only way to reach it is the real thing: the poller has to notice a changed
  // catalog. Poll interval 300ms plus a 50ms debounce, so the wait is generous
  // rather than tight — a test that races its own watcher is worse than none.
  const dir = tempCatalog();
  const output = path.join(dir, 'next-fluent.d.ts');
  const logs = [];
  const keep = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    const apply = createNextFluentPlugin('./src/i18n/request.ts', {
      typegen: { input: dir, output, watch: true },
    });
    apply({});
    logs.length = 0; // ignore the initial generation notice

    await new Promise((resolve) => setTimeout(resolve, 60));
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'greeting = Hello\nfarewell = Bye\n');
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    console.log = keep;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.ok(
    logs.some((line) => /Regenerated message types/.test(line)),
    `expected a regeneration notice after the edit, got ${JSON.stringify(logs)}`
  );
});
