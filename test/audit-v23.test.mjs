/**
 * Audit pass 23 — see ENGINEERING_AUDIT_V23.md.
 *
 * The previous passes left a short list of branches no test reached. Every one
 * of them turned out to be reachable through the public API; none needed a
 * mock, only an input nobody had tried. The pass also removes a warning that
 * provably could not fire.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectCatalogFiles, collectSourceFiles, watchCatalogs } from '../dist/catalog-io.js';
import { validateLocalePrefix, matchSupportedLocale } from '../dist/utils.js';
import { formatUrlObject, resolveLocalizedPathname } from '../dist/nav-url.js';
import { FluentError, createFluentBundle, createTranslator } from '../dist/bundle.js';

/** Captures `console.warn` output while `body` runs. */
function captureWarnings(body) {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.map(String).join(' '));
  try {
    return { result: body(), seen };
  } finally {
    console.warn = original;
  }
}

// ---------------------------------------------------------------------------
// V23-01: the dev watcher reports a bad target instead of dying silently
// ---------------------------------------------------------------------------

test('V23-01: watching something that is not a directory reports through onError', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v23-'));
  const file = path.join(dir, 'en.ftl');
  fs.writeFileSync(file, 'a = A\n');
  const errors = [];

  try {
    // `fs.watch` does not fail consistently across platforms: some hand back a
    // watcher that never fires, leaving the dev watcher silently dead. The
    // target is checked first, so the caller hears about it.
    const stop = watchCatalogs(file, path.join(dir, 'out'), {
      onError: (error) => errors.push(error),
    });

    assert.equal(errors.length, 1, 'onError must be called exactly once');
    assert.match(errors[0].message, /Cannot watch/);
    assert.match(errors[0].message, /not a directory/);
    const escaped = new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(errors[0].message, escaped, 'the message names the target');
    assert.equal(typeof stop, 'function', 'a stop function is returned even on failure');
    stop(); // must not throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V23-01: a target that does not exist at all reports the same way', () => {
  const missing = path.join(os.tmpdir(), `next-fluent-v23-missing-${process.pid}`);
  const errors = [];
  const stop = watchCatalogs(missing, missing, { onError: (error) => errors.push(error) });

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /not a directory/);
  stop();
});

// ---------------------------------------------------------------------------
// V23-02: a dangling symlink in the source tree must not break the usage scan
// ---------------------------------------------------------------------------

test('V23-02: collectSourceFiles survives a symlink whose target is gone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v23-src-'));
  try {
    fs.writeFileSync(path.join(dir, 'real.tsx'), "const a = t('greeting');\n");
    try {
      // Relative, so the link is not dangling for the wrong reason.
      fs.symlinkSync('nowhere.tsx', path.join(dir, 'broken.tsx'));
    } catch {
      // Windows refuses symlink creation without a privilege; there is nothing
      // to test there rather than a failure to hide.
      t.skip('this platform refuses to create symlinks');
      return;
    }

    let files;
    assert.doesNotThrow(() => {
      files = collectSourceFiles(dir);
    }, 'an unresolvable link must not abort the scan');

    assert.ok(
      files.some((file) => file.endsWith('real.tsx')),
      `the real file must still be found, got ${JSON.stringify(files)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// V23-03: the one malformed `localePrefix.prefixes` shape no test had tried
// ---------------------------------------------------------------------------

test('V23-03: prefixes that are not an object are rejected at boot', () => {
  for (const bad of ['nope', 42, null, true]) {
    assert.throws(
      () => validateLocalePrefix(['en', 'ru'], { prefixes: bad }),
      /"localePrefix\.prefixes" must be an object/,
      `prefixes: ${JSON.stringify(bad)} must be rejected`
    );
  }
  // The shapes next to it stay valid, so the check is not over-broad.
  assert.doesNotThrow(() => validateLocalePrefix(['en', 'ru'], { prefixes: {} }));
  assert.doesNotThrow(() => validateLocalePrefix(['en', 'ru'], { prefixes: { ru: '/ru' } }));
  assert.doesNotThrow(() => validateLocalePrefix(['en', 'ru'], { mode: 'always' }));
});

// ---------------------------------------------------------------------------
// V23-04: an unusable locale tag must not escape the candidate builder
// ---------------------------------------------------------------------------

test('V23-04: an invalid locale tag yields no candidates instead of throwing', () => {
  // `new Intl.Locale(tag)` throws on garbage; the builder swallows it so a bad
  // tag from a request header degrades to "no match" rather than a 500.
  for (const bad of ['not a tag!', '', '!!!', 'en-']) {
    assert.doesNotThrow(
      () => matchSupportedLocale(bad, ['en', 'ru']),
      `tag ${JSON.stringify(bad)} must not throw`
    );
    assert.equal(matchSupportedLocale(bad, ['en', 'ru']), undefined);
  }
  // …and a real tag still matches, so the swallow is not blanket.
  assert.equal(matchSupportedLocale('ru', ['en', 'ru']), 'ru');
  assert.equal(matchSupportedLocale('RU', ['en', 'ru']), 'ru');
});

// ---------------------------------------------------------------------------
// V23-05: an unknown error code still produces a message
// ---------------------------------------------------------------------------

test('V23-05: a code the enum does not know still describes itself', () => {
  // The default branch exists for callers in plain JavaScript, where nothing
  // stops a string that is not one of the codes. Without it the message would
  // be `undefined`.
  const error = new FluentError({ code: 'NOT_A_REAL_CODE', key: 'greeting' });
  assert.equal(error.message, '[next-fluent] Localization error for "greeting"');

  const namespaced = new FluentError({
    code: 'NOT_A_REAL_CODE',
    key: 'greeting',
    namespace: 'common',
  });
  assert.equal(namespaced.message, '[next-fluent] Localization error for "common.greeting"');

  // The real codes keep their specific wording.
  assert.match(
    new FluentError({ code: 'MISSING_MESSAGE', key: 'greeting', locale: 'en' }).message,
    /Missing message "greeting" \(locale: en\)/
  );
});

// ---------------------------------------------------------------------------
// V23-06: a UrlObject pathname without a leading slash is normalized
// ---------------------------------------------------------------------------

test('V23-06: formatUrlObject gives a pathname its leading slash', () => {
  assert.deepEqual(formatUrlObject({ pathname: 'about' }), {
    pathname: '/about',
    search: '',
    hash: '',
  });
  // Already-absolute input is untouched, and the rest of the object survives.
  assert.deepEqual(formatUrlObject({ pathname: '/about', search: '?a=1', hash: '#top' }), {
    pathname: '/about',
    search: '?a=1',
    hash: '#top',
  });
  assert.equal(formatUrlObject({}).pathname, '/');
});

// ---------------------------------------------------------------------------
// V23-07: the warning this pass removed could not have fired
// ---------------------------------------------------------------------------

test('V23-07: duplicate ids resolve last-wins and the bundle path stays quiet', () => {
  // `addResource` pushes an error only for an override it refused, and
  // `allowOverrides: true` refuses nothing. The `console.warn` that used to sit
  // on that return value was therefore unreachable — verified against
  // `@fluent/bundle`, whose only two `errors.push` calls are both guarded by
  // `allowOverrides === false`. A duplicate is resolved last-wins on purpose and
  // reported where the catalog is read, not here.
  const id = `dupe${Date.now()}`;
  const source = `${id} = FIRST\n${id} = SECOND\n`;

  const { seen } = captureWarnings(() => createFluentBundle('en', source, { useIsolating: false }));
  assert.deepEqual(seen, [], 'the bundle path emits no warning for a duplicate');

  const bundle = createFluentBundle('en', source, { useIsolating: false });
  const t = createTranslator(bundle);
  assert.equal(t(id), 'SECOND', 'the later definition wins');
});

// ---------------------------------------------------------------------------
// V23-08: a fallback that returns a non-string must not be handed to React
// ---------------------------------------------------------------------------

test('V23-08: a getMessageFallback returning a non-string falls back again', () => {
  // The branch exists because `getMessageFallback` is user code and JavaScript
  // callers can return anything. Rendering `undefined` or `42` into the tree
  // would be worse than the library's own fallback.
  const bundle = createFluentBundle('en', 'present = Here\n', { useIsolating: false });
  // Compared against the library's own default rather than a hardcoded format,
  // so the test pins the degradation and not the wording of the fallback.
  const expected = createTranslator(bundle)('absent');
  assert.equal(typeof expected, 'string');

  for (const bad of [undefined, null, 42, {}, []]) {
    const t = createTranslator(bundle, { getMessageFallback: () => bad });
    assert.equal(
      t('absent'),
      expected,
      `fallback returning ${JSON.stringify(bad)} must degrade to the default`
    );
  }

  // A string is still respected.
  const ok = createTranslator(bundle, { getMessageFallback: ({ key }) => `[${key}]` });
  assert.equal(ok('absent'), '[absent]');
});

// ---------------------------------------------------------------------------
// V23-09: an href without a leading slash is normalized before it is resolved
// ---------------------------------------------------------------------------

test('V23-09: resolveLocalizedPathname gives a bare href its leading slash', () => {
  const config = { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' };

  assert.equal(
    resolveLocalizedPathname({ href: 'about', locale: 'ru' }, config),
    resolveLocalizedPathname({ href: '/about', locale: 'ru' }, config),
    'a bare pathname must resolve exactly like its absolute form'
  );
  assert.equal(resolveLocalizedPathname({ href: 'about', locale: 'ru' }, config), '/ru/about');
});

// ---------------------------------------------------------------------------
// V23-10: a dangling symlink inside the catalog tree must not break the read
// ---------------------------------------------------------------------------

test('V23-10: collectCatalogFiles skips a catalog symlink whose target is gone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v23-cat-'));
  try {
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'a = A\n');
    try {
      fs.symlinkSync('nowhere.ftl', path.join(dir, 'ru.ftl'));
    } catch {
      t.skip('this platform refuses to create symlinks');
      return;
    }

    let files;
    assert.doesNotThrow(() => {
      files = collectCatalogFiles(dir);
    }, 'a link that resolves to nothing must be skipped, not fatal');

    assert.deepEqual(
      files.map((file) => path.basename(file)),
      ['en.ftl'],
      'the unreadable link is dropped and the real catalog survives'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// V23-11: a source directory that is not there yields nothing, not a crash
// ---------------------------------------------------------------------------

test('V23-11: collectSourceFiles on a missing directory returns nothing', () => {
  const missing = path.join(os.tmpdir(), `next-fluent-v23-nosrc-${process.pid}`);
  assert.equal(fs.existsSync(missing), false, 'the fixture must not exist');

  let files;
  assert.doesNotThrow(() => {
    files = collectSourceFiles(missing);
  }, 'a missing scan root must not throw into the caller');
  assert.deepEqual(files, []);
});

// ---------------------------------------------------------------------------
// V23-12: a target whose parent is a file is still reported, not thrown
// ---------------------------------------------------------------------------

test('V23-12: a watch target that cannot even be stat-ed reports through onError', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v23-enotdir-'));
  const file = path.join(dir, 'en.ftl');
  fs.writeFileSync(file, 'a = A\n');
  const errors = [];

  try {
    // `statSync(…, { throwIfNoEntry: false })` swallows ENOENT but not ENOTDIR,
    // so a path through a file throws for real. The watcher must turn that into
    // the same `onError` as any other unusable target rather than propagate it.
    const through = path.join(file, 'sub');
    const stop = watchCatalogs(through, path.join(dir, 'out'), {
      onError: (error) => errors.push(error),
    });

    assert.equal(errors.length, 1, 'onError must be called exactly once');
    assert.match(errors[0].message, /Cannot watch/);
    assert.match(errors[0].message, /not a directory/);
    stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V23-13: a target that makes stat itself fail still reports through onError', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v23-eloop-'));
  try {
    // Measured, not assumed: `statSync(…, { throwIfNoEntry: false })` swallows
    // both ENOENT and ENOTDIR and returns `undefined`, so a path through a file
    // never reaches the catch. A symlink loop is what actually throws (ELOOP),
    // which is the only deterministic way into it.
    try {
      fs.symlinkSync('loop', path.join(dir, 'loop'));
    } catch {
      t.skip('this platform refuses to create symlinks');
      return;
    }

    const errors = [];
    const stop = watchCatalogs(path.join(dir, 'loop'), path.join(dir, 'out'), {
      onError: (error) => errors.push(error),
    });

    assert.equal(errors.length, 1, 'onError must be called exactly once');
    assert.match(errors[0].message, /Cannot watch/);
    assert.match(errors[0].message, /not a directory/);
    stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
