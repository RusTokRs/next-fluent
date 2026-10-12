/**
 * Audit pass 18 — see ENGINEERING_AUDIT_V18.md.
 *
 * V17 closed by naming three places to look next: the catalog reader that
 * `check` runs on, the JSON → FTL conversion, and the analyzer's tail. The first
 * two both had something, and both failures were silent:
 *
 *   - `check` dropped a symlinked catalog, elected a different reference locale,
 *     and answered "No issues found" for a translation that was missing;
 *   - `check` and the runtime sorted catalogs by different rules, so they
 *     disagreed about which of two duplicate definitions survived;
 *   - `jsonToFluent` emitted the same FTL attribute twice and let the runtime
 *     drop one of the author's translations without a word.
 *
 * The fourth finding is a functionality gap rather than a crash: `redirect()`
 * resolved against `defaultLocale` while `useRouter().push` resolved against the
 * current locale, so the same href meant two different pages. Its request-scope
 * half is asserted by `scripts/test-next-integration.mjs`, not here — see
 * V18-04 below for why a Node test of it would be a lie.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import test from 'node:test';

import { jsonToFluent } from '../dist/catalog.js';
import {
  collectCatalogFiles,
  readCatalog,
  readCatalogsByLocale,
} from '../dist/catalog-io.js';
import { checkCatalogs, formatCheckReport } from '../dist/check.js';
import { createNavigation } from '../dist/navigation.js';
import { requestLocale } from '../dist/request-store.js';
import { FluentBundle, FluentResource } from '@fluent/bundle';

function withDir(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v18-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Formats the value of `id` the way the runtime does: last definition wins. */
function runtimeValue(sources, id) {
  const bundle = new FluentBundle('en', { useIsolating: false });
  bundle.addResource(new FluentResource(sources.join('\n')), { allowOverrides: true });
  const message = bundle.getMessage(id);
  assert.ok(message?.value, `expected the runtime to resolve "${id}"`);
  return bundle.formatPattern(message.value);
}

// ---------------------------------------------------------------------------
// V18-01: jsonToFluent emitted the same attribute twice
// ---------------------------------------------------------------------------

test('V18-01: two JSON keys that name one attribute are rejected, not merged', () => {
  // `normalizeId` folds `.` into `-`, and a leading `.` is accepted as the
  // attribute marker — so both pairs below land on a single FTL attribute.
  const colliding = [
    { card: { '': 'v', label: 'PLAIN', '.label': 'DOTTED' } },
    { card: { '': 'v', 'a.b': 'DOTTED', 'a-b': 'DASHED' } },
  ];

  for (const catalog of colliding) {
    assert.throws(
      () => jsonToFluent(catalog),
      (error) => {
        assert.match(error.message, /both map to the attribute/);
        // Both JSON paths have to be named, or the author cannot tell which of
        // their two keys to rename.
        assert.match(error.message, /card/);
        assert.equal(error.code, 'INVALID_ARGUMENT');
        return true;
      },
      `expected a collision error for ${JSON.stringify(catalog)}`
    );
  }
});

test('V18-01: the collision guard does not reject attributes that merely look alike', () => {
  const ftl = jsonToFluent({
    card: { '': 'v', label: 'Label', '.title': 'Title', 'aria-label': 'Aria' },
  });
  // Three distinct attributes, one of them written with the leading-dot marker.
  assert.match(ftl, /\.label = Label/);
  assert.match(ftl, /\.title = Title/);
  assert.match(ftl, /\.aria-label = Aria/);

  const bundle = new FluentBundle('en', { useIsolating: false });
  bundle.addResource(new FluentResource(ftl));
  const message = bundle.getMessage('card');
  assert.deepEqual(Object.keys(message.attributes).sort(), ['aria-label', 'label', 'title']);
});

test('V18-01: attribute and message id collisions report the same class of error', () => {
  const byId = (() => {
    try {
      jsonToFluent({ 'card-title': 'A', card: { title: 'B' } });
    } catch (error) {
      return error;
    }
    throw new Error('expected the id collision to throw');
  })();
  const byAttribute = (() => {
    try {
      jsonToFluent({ card: { '': 'v', label: 'A', '.label': 'B' } });
    } catch (error) {
      return error;
    }
    throw new Error('expected the attribute collision to throw');
  })();

  // One authoring mistake, one diagnosis shape — this is the inconsistency the
  // pass exists to remove.
  assert.equal(byId.code, byAttribute.code);
  assert.equal(byId.name, byAttribute.name);
  assert.match(byId.message, /Rename one of them/);
  assert.match(byAttribute.message, /Rename one of them/);
});

test('V18-01: JSON values survive the trip to FTL and back byte for byte', () => {
  // The conversion is the one place where a bug does not throw or 404 — it
  // quietly changes what a message says. Every code point in the BMP that a
  // catalog could realistically hold, plus the shapes Fluent parses as syntax.
  const samples = [];
  for (let code = 0; code < 0x3000; code++) samples.push(String.fromCodePoint(code));
  samples.push(
    ' ', ' lead', 'trail ', '\t', '\n', '\r', '\r\n', 'a\n\nb', 'a\n', '\n\n', 'a\nb\n',
    '{}', '{ x }', '{ "lit" }', '{"}"', '\\', '"q"', '#c', '.attr', '*d', '[s]', '-term',
    '  spaced  ', 'a\rb', 'a\r\nb\r\nc', '\u0000nul', 'end with {', 'start }', '{a}{b}',
    'a\u2028b', 'a\u0085b', 'a\u2029b', '\u00a0nbsp\u00a0', 'x'.repeat(3000),
    'multi\n\n\nline', 'a\n b', 'tab\tin\tmiddle', 'select { $n -> [one] one *[other] many }'
  );

  const bundle = new FluentBundle('en', { useIsolating: false });
  const drifted = [];
  let variables = 0;
  for (const sample of samples) {
    const ftl = jsonToFluent({ k: sample });
    // `{count}` and `{$count}` are *meant* to become Fluent variables, so they
    // are not literal text and cannot round-trip through a format with no
    // arguments. Counted, not silently skipped.
    if (/\{ \$/.test(ftl)) {
      variables++;
      continue;
    }
    bundle.addResource(new FluentResource(ftl), { allowOverrides: true });
    const message = bundle.getMessage('k');
    if (!message?.value) {
      drifted.push([sample, '<message did not parse>']);
      continue;
    }
    const errors = [];
    const out = bundle.formatPattern(message.value, undefined, errors);
    if (errors.length > 0) {
      drifted.push([sample, `format error: ${errors[0].message}`]);
      continue;
    }
    // A carriage return is the one documented loss: Fluent cannot represent it
    // at all, so the converter normalizes line breaks to LF on purpose.
    if (out !== sample.replace(/\r\n?/g, '\n')) drifted.push([sample, out]);
  }

  assert.ok(variables > 0, 'the sample set must exercise the variable conversion');
  assert.deepEqual(
    drifted.slice(0, 5),
    [],
    `${drifted.length} of ${samples.length} values did not round-trip`
  );
});

// ---------------------------------------------------------------------------
// V18-02: check dropped symlinked catalogs
// ---------------------------------------------------------------------------

/**
 * Creates `link` pointing at `target`. Returns false when the platform refuses
 * (Windows without the privilege), so the suite reports a skip instead of a
 * failure that says nothing about the library.
 */
function trySymlink(target, link) {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP') return false;
    throw error;
  }
}

const SHARED = 'hello = Hello\nonly_in_shared = Shared only\n';
const RU = 'hello = Привет\n';

test('V18-02: a symlinked catalog file becomes a locale', () => {
  withDir({ 'shared/en.ftl': SHARED, 'ru.ftl': RU }, (dir) => {
    if (!trySymlink(path.join('shared', 'en.ftl'), path.join(dir, 'en.ftl'))) {
      console.log('# skip: this platform refuses to create symlinks');
      return;
    }
    // The link is readable — if the assertion below fails it is the walk, not
    // the fixture, that dropped it.
    assert.equal(fs.readFileSync(path.join(dir, 'en.ftl'), 'utf8'), SHARED);

    const catalogs = readCatalogsByLocale(dir);
    assert.deepEqual(Object.keys(catalogs).sort(), ['en', 'ru', 'shared']);
    assert.equal(catalogs.en.length, 1, 'the linked catalog must be read');
    assert.match(catalogs.en[0], /only_in_shared/);
  });
});

test('V18-02: check reports the same issues for a symlinked and a real catalog', () => {
  const build = (link) =>
    withDir({ 'shared/en.ftl': SHARED, 'ru.ftl': RU }, (dir) => {
      if (link) {
        if (!trySymlink(path.join('shared', 'en.ftl'), path.join(dir, 'en.ftl'))) return null;
      } else {
        fs.copyFileSync(path.join(dir, 'shared', 'en.ftl'), path.join(dir, 'en.ftl'));
      }
      const catalogs = readCatalogsByLocale(dir);
      // `shared/` is its own pseudo-locale in both trees; it is not what is
      // under test and it must not be the thing that makes the two differ.
      return formatCheckReport(checkCatalogs(catalogs));
    });

  const real = build(false);
  const linked = build(true);
  if (linked === null) {
    console.log('# skip: this platform refuses to create symlinks');
    return;
  }

  // Before the pass these differed: the linked tree checked 2 catalogs against
  // "ru" and found nothing, the real one checked 3 against "en" and reported
  // the missing Russian translation.
  assert.equal(linked, real);
  assert.match(real, /Checked 3 catalog\(s\) against "en"/);
  assert.match(real, /\[missing\] "only_in_shared" is missing/);
});

test('V18-02: check and typegen read the same files from the same tree', () => {
  withDir({ 'shared/en.ftl': SHARED, 'ru.ftl': RU }, (dir) => {
    if (!trySymlink(path.join('shared', 'en.ftl'), path.join(dir, 'en.ftl'))) {
      console.log('# skip: this platform refuses to create symlinks');
      return;
    }
    const walked = collectCatalogFiles(dir).map((file) => path.relative(dir, file)).sort();
    const grouped = Object.values(readCatalogsByLocale(dir))
      .flat()
      .length;
    assert.equal(grouped, walked.length, 'both walks must see the same number of catalogs');
    assert.ok(walked.includes('en.ftl'), 'the walk the runtime uses sees the link');
  });
});

// ---------------------------------------------------------------------------
// V18-03: the validator and the runtime disagreed about "last wins"
// ---------------------------------------------------------------------------

test('V18-03: check and the runtime keep the same duplicate definition', () => {
  withDir({ 'EN.ftl': 'k = FROM_UPPER\n', 'en.ftl': 'k = FROM_LOWER\n' }, (dir) => {
    const walked = collectCatalogFiles(dir).map(readCatalog);
    const grouped = readCatalogsByLocale(dir);

    assert.deepEqual(Object.keys(grouped), ['en']);
    // The two walks are now the same walk, so the order cannot drift.
    assert.deepEqual(grouped.en, walked);
    assert.equal(runtimeValue(grouped.en, 'k'), runtimeValue(walked, 'k'));
  });
});

test('V18-03: catalog order does not depend on the process locale', async () => {
  // `localeCompare` collates by the ICU default locale, which Node takes from
  // the environment — so a build-time tool that sorted with it produced
  // different output on different machines. Read the same tree under two
  // collations, in child processes, and require the same answer.
  const module = path.resolve('dist/catalog-io.js').replaceAll('\\', '/');
  const script =
    `import { readCatalogsByLocale } from '${module}';\n` +
    'process.stdout.write(JSON.stringify(readCatalogsByLocale(process.argv[2]).en));\n';
  const file = path.join(os.tmpdir(), `next-fluent-v18-collation-${process.pid}.mjs`);
  fs.writeFileSync(file, script);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-v18-icu-'));
  try {
    fs.writeFileSync(path.join(dir, 'EN.ftl'), 'k = FROM_UPPER\n');
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'k = FROM_LOWER\n');

    const read = (env) =>
      new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          [file, dir],
          { env: { ...process.env, ...env } },
          (error, stdout) => (error ? reject(error) : resolve(stdout))
        );
      });

    const american = await read({ LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' });
    const turkish = await read({ LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' });

    assert.equal(american, turkish, 'the merge order must not depend on ICU collation');
    // Code-unit order, i.e. the order the runtime and `typegen` use.
    assert.deepEqual(JSON.parse(american), ['k = FROM_UPPER\n', 'k = FROM_LOWER\n']);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// V18-04: redirect() resolved against the default locale
// ---------------------------------------------------------------------------

const routing = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: false,
  pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
};

const redirectTarget = (fn, ...args) => {
  try {
    fn(...args);
  } catch (error) {
    const digest = String(error.digest ?? '');
    const match = digest.match(/^NEXT_REDIRECT;[^;]*;([^;]*);/);
    if (match) return match[1];
    throw error;
  }
  throw new Error('expected redirect() to throw NEXT_REDIRECT');
};

test('V18-04: an explicit locale still wins over everything else', () => {
  const nav = createNavigation(routing);
  assert.equal(redirectTarget(nav.redirect, '/about', { locale: 'ru' }), '/ru/o-nas');
  assert.equal(redirectTarget(nav.permanentRedirect, '/about', { locale: 'ru' }), '/ru/o-nas');
  assert.equal(redirectTarget(nav.redirect, { href: '/about', locale: 'en' }), '/en/about-us');
});

test('V18-04: outside a request scope the default locale is still the fallback', () => {
  // No React request scope exists in `node --test`, so `cache()` memoizes
  // nothing and there is no locale to consult. This is the behaviour the pass
  // must not change.
  assert.equal(requestLocale(), undefined);
  const nav = createNavigation(routing);
  assert.equal(redirectTarget(nav.redirect, '/about'), '/en/about-us');
  assert.equal(redirectTarget(nav.permanentRedirect, '/about'), '/en/about-us');
});

test('V18-04: the request store is one module shared by server and navigation', () => {
  // The fix only holds if both entries read the *same* store instance. The build
  // transpiles every module separately, so there is exactly one
  // `request-store.js`; this pins the import shape that guarantees it.
  const navigation = fs.readFileSync(path.resolve('dist/navigation.js'), 'utf8');
  const server = fs.readFileSync(path.resolve('dist/server.js'), 'utf8');
  assert.match(navigation, /from "\.\/request-store\.js"/);
  assert.match(server, /from "\.\/request-store\.js"/);
  // And the server entry keeps re-exporting the store it used to own.
  assert.match(server, /export \{[^}]*getRequestStore/);
});
