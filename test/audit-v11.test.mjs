/**
 * Audit pass 10 — see ENGINEERING_AUDIT_V10.md.
 *
 * Pass 9 fixed the gates. This one used the coverage report as a work list: the
 * modules where lines are simply never executed, rather than where they are
 * executed and wrong. That pointed at two things — the server-side locale
 * detection path, which no environment could reach (fixed in the Next
 * integration fixture, where a request scope finally exists), and the `pseudo`
 * CLI command, which had no test at all and turned out to destroy the catalogs
 * it was given.
 *
 * Every finding below is reproduced first and covered by a test that fails
 * without the fix.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(root, 'bin/next-fluent.mjs');

/** Runs the CLI in a throwaway directory. */
function runCli(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** Drops Fluent's bidi isolation marks so assertions can name the text. */
function stripIsolators(text) {
  return String(text).replace(/[\u2066-\u2069]/g, '');
}

/** Removes comments so a test can assert on code rather than on prose. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A project directory with catalogs; the caller writes the files. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-pseudo-'));
  fs.mkdirSync(path.join(dir, 'messages'));
  return {
    dir,
    write: (name, content) => fs.writeFileSync(path.join(dir, 'messages', name), content),
    read: (name) => fs.readFileSync(path.join(dir, 'messages', name), 'utf8'),
    exists: (name) => fs.existsSync(path.join(dir, name)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// V10-02. `pseudo` wrote over the catalogs it generated from
// ---------------------------------------------------------------------------

test('pseudo refuses an output directory that is the input directory', () => {
  const p = project();
  try {
    p.write('en.ftl', 'greeting = Hi\nbye = Bye\n');
    const before = p.read('en.ftl');

    // Looks like a harmless slip — "put them where they already are" — and it
    // replaced the real catalog with `[Ĥîî]` before failing on an unrelated
    // file, so the error named the wrong cause entirely.
    const { status, output } = runCli(p.dir, ['pseudo', '--input', 'messages', '--output', 'messages']);
    assert.equal(status, 1, output);
    assert.match(output, /would overwrite the catalog/);
    assert.ok(
      output.includes(path.join(p.dir, 'messages', 'en.ftl')),
      'the message names the file that would have been destroyed'
    );
    assert.match(output, /different output directory/, 'and says what to do instead');
    assert.equal(p.read('en.ftl'), before, 'the source catalog has to survive');
  } finally {
    p.cleanup();
  }
});

test('pseudo refuses an output file that is the input file', () => {
  const p = project();
  try {
    p.write('en.ftl', 'greeting = Hi\n');
    const { status, output } = runCli(p.dir, [
      'pseudo',
      '--input',
      'messages/en.ftl',
      '--output',
      'messages/en.ftl',
    ]);
    assert.equal(status, 1, output);
    assert.match(output, /would overwrite the catalog/);
    assert.equal(p.read('en.ftl'), 'greeting = Hi\n');
  } finally {
    p.cleanup();
  }
});

// ---------------------------------------------------------------------------
// V10-03. `pseudo` wrote file by file, so a failure left half a result
// ---------------------------------------------------------------------------

test('pseudo writes nothing at all when one catalog cannot be read', () => {
  const p = project();
  try {
    // Sorted collection means `en.ftl` is processed first: before the fix it was
    // already replaced with pseudo text when the JSON catalog blew up.
    p.write('en.ftl', 'greeting = Hi\n');
    p.write('ru.json', 'greeting = Привет\n'); // FTL content in a .json file

    const { status, output } = runCli(p.dir, ['pseudo', '--input', 'messages', '--output', 'out']);
    assert.equal(status, 1, output);
    assert.match(output, /Cannot read the catalog/);
    assert.equal(
      p.exists('out'),
      false,
      'nothing may be written when the batch fails — the output directory itself must not appear'
    );
    assert.equal(p.read('en.ftl'), 'greeting = Hi\n', 'and no source may be touched');
    assert.equal(p.read('ru.json'), 'greeting = Привет\n');
  } finally {
    p.cleanup();
  }
});

// ---------------------------------------------------------------------------
// V10-04. The `pseudo` command had no coverage at all
// ---------------------------------------------------------------------------

test('pseudo mirrors a directory of catalogs and converts .json to .ftl', () => {
  const p = project();
  try {
    fs.mkdirSync(path.join(p.dir, 'messages/nested'));
    p.write('en.ftl', 'greeting = Hi\n');
    p.write('ru.json', JSON.stringify({ greeting: 'Привет' }));
    fs.writeFileSync(
      path.join(p.dir, 'messages/nested/de.ftl'),
      'greeting = Hallo\n',
      'utf8'
    );

    const { status, output } = runCli(p.dir, ['pseudo', '--input', 'messages', '--output', 'out']);
    assert.equal(status, 0, output);
    assert.match(output, /Generated pseudo-locales for 3 file\(s\)/);

    // Pseudo-localization rewrites the letters themselves (`Hi` -> `[Ĥîî]`),
    // so the check is "bracketed and different", not the exact spelling.
    const generated = fs.readFileSync(path.join(p.dir, 'out/en.ftl'), 'utf8');
    assert.notEqual(generated, 'greeting = Hi\n', 'the output must be pseudo-localized');
    assert.match(generated, /^greeting = \[.+\]$/m, `expected a bracketed value, got ${JSON.stringify(generated)}`);
    // `.json` sources keep their place and become `.ftl`.
    assert.ok(fs.existsSync(path.join(p.dir, 'out/ru.ftl')));
    assert.ok(fs.existsSync(path.join(p.dir, 'out/nested/de.ftl')));
    assert.equal(fs.existsSync(path.join(p.dir, 'out/ru.json')), false);
    // Sources are still sources.
    assert.equal(p.read('en.ftl'), 'greeting = Hi\n');
  } finally {
    p.cleanup();
  }
});

test('pseudo handles a single file and creates missing directories', () => {
  const p = project();
  try {
    p.write('en.ftl', 'greeting = Hi\n');
    const { status, output } = runCli(p.dir, [
      'pseudo',
      '--input',
      'messages/en.ftl',
      '--output',
      'deep/nested/pseudo.ftl',
    ]);
    assert.equal(status, 0, output);
    assert.match(output, /Generated pseudo-locale at/);
    const generated = fs.readFileSync(path.join(p.dir, 'deep/nested/pseudo.ftl'), 'utf8');
    assert.match(generated, /^greeting = \[.+\]$/m);
  } finally {
    p.cleanup();
  }
});

test('pseudo requires --output and rejects a file output for a directory input', () => {
  const p = project();
  try {
    p.write('en.ftl', 'greeting = Hi\n');

    const missing = runCli(p.dir, ['pseudo', '--input', 'messages']);
    assert.equal(missing.status, 1);
    assert.match(missing.output, /--output is required/);

    const wrongShape = runCli(p.dir, [
      'pseudo',
      '--input',
      'messages',
      '--output',
      'all.ftl',
    ]);
    assert.equal(wrongShape.status, 1);
    assert.match(wrongShape.output, /must be a directory when --input is a directory/);
  } finally {
    p.cleanup();
  }
});

// ---------------------------------------------------------------------------
// V10-01. The locale list that makes `Accept-Language` work is undocumented
// ---------------------------------------------------------------------------

test('the server locale configuration is documented where an app would look for it', async () => {
  const readme = await fs.promises.readFile(path.join(root, 'README.md'), 'utf8');
  // `configureServerI18n` is exported from `next-fluent/server` and decides
  // whether `getLocale()` negotiates `Accept-Language` at all — a browser
  // preference silently ignored when it is missing, with nothing in the README
  // to explain why.
  assert.match(readme, /configureServerI18n/, 'the server-side locale configuration is undocumented');
  const mention = readme.slice(readme.indexOf('configureServerI18n'));
  assert.match(
    mention.slice(0, 1200),
    /getLocale/,
    'the documentation has to say what configuring the locales changes'
  );
});

test('the integration fixture exercises server-side locale detection', async () => {
  const harness = await fs.promises.readFile(
    path.join(root, 'scripts/test-next-integration.mjs'),
    'utf8'
  );
  assert.match(
    harness,
    /checkLocaleDetection/,
    'the request-scope path of getLocale() has to be verified somewhere'
  );
  const probe = await fs.promises.readFile(
    path.join(root, 'test/fixtures/next-app/app/probe/page.tsx'),
    'utf8'
  );
  // Comments explain why the route must not pin the locale, so the check looks
  // at code only.
  const probeCode = stripComments(probe);
  assert.match(probeCode, /getLocale\(/, 'the probe route resolves its own locale');
  assert.doesNotMatch(
    probeCode,
    /setRequestLocale\(/,
    'a route that pins the locale would never enter the detection path'
  );
  const serverConfig = await fs.promises.readFile(
    path.join(root, 'test/fixtures/next-app/i18n/server-config.ts'),
    'utf8'
  );
  assert.match(serverConfig, /configureServerI18n/, 'without a locale list there is nothing to negotiate');
});
// ---------------------------------------------------------------------------
// V10-05. The fallback-locale chain and `runtime.getMessages` ran in no test
// ---------------------------------------------------------------------------
// Both are reachable and both were correct when probed by hand — the point of
// listing them here is that a silent change to either would have gone unnoticed:
// `runtime.getMessages` had never been called once in the whole suite.

import { getRequestConfig, getTranslations, setRequestConfig } from '../dist/server.js';
import { createI18n } from '../dist/factory.js';

const CATALOGS = {
  en: { greeting: 'Hello', only_en: 'English only', both: 'en-both' },
  ru: { greeting: 'Привет' },
  de: { only_en: 'Deutsch', both: 'de-both' },
};

/** Installs a request config for the tests below and restores the old one. */
function withConfig(fn) {
  const previous = getRequestConfig();
  setRequestConfig(async ({ locale }) => ({ locale, messages: CATALOGS[locale] ?? {} }));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous) setRequestConfig(previous);
    });
}

test('a message missing from the locale is taken from the fallback', async () => {
  await withConfig(async () => {
    const t = await getTranslations({ locale: 'ru', fallbackLocale: 'en' });
    assert.equal(t('only_en'), 'English only');
    // The locale itself still wins where it has the message.
    assert.equal(t('greeting'), 'Привет');
  });
});

test('fallbackLocales are consulted in the order they are given', async () => {
  await withConfig(async () => {
    const deFirst = await getTranslations({ locale: 'ru', fallbackLocales: ['de', 'en'] });
    assert.equal(deFirst('both'), 'de-both');
    const enFirst = await getTranslations({ locale: 'ru', fallbackLocales: ['en', 'de'] });
    assert.equal(enFirst('both'), 'en-both');
  });
});

test('fallbackLocale outranks fallbackLocales', async () => {
  await withConfig(async () => {
    const t = await getTranslations({ locale: 'ru', fallbackLocale: 'en', fallbackLocales: ['de'] });
    assert.equal(t('both'), 'en-both', 'the explicit fallback comes first in the chain');
  });
});

test('a fallback locale nobody has a catalog for does not break the lookup', async () => {
  await withConfig(async () => {
    const t = await getTranslations({ locale: 'ru', fallbackLocales: ['zz'] });
    // Nothing anywhere has it: the key itself is the last resort.
    assert.equal(t('only_en'), 'only_en');
    // Junk entries are skipped rather than treated as a locale.
    const withJunk = await getTranslations({ locale: 'ru', fallbackLocales: [null, '', 'en'] });
    assert.equal(withJunk('only_en'), 'English only');
  });
});

test('runtime.getMessages returns the catalog the request config loaded', async () => {
  await withConfig(async () => {
    const runtime = createI18n({ locales: ['en', 'ru'], defaultLocale: 'en' });
    assert.deepEqual(await runtime.getMessages('ru'), CATALOGS.ru);
    // No locale: the runtime resolves one itself.
    assert.deepEqual(await runtime.getMessages(), CATALOGS.en);
  });
});

test('runtime.getMessages prefers a configured loader over the request config', async () => {
  const calls = [];
  await withConfig(async () => {
    const runtime = createI18n({
      locales: ['en'],
      defaultLocale: 'en',
      loadMessages: async (locale) => {
        calls.push(locale);
        return { from: 'loader' };
      },
    });
    assert.deepEqual(await runtime.getMessages('en'), { from: 'loader' });
    assert.deepEqual(await runtime.getMessages(), { from: 'loader' });
  });
  assert.deepEqual(calls, ['en', 'en'], 'the loader is asked once per call, with the resolved locale');
});

test('a currency value that is not a number comes back as the caller wrote it', async () => {
  await withConfig(async () => {
    setRequestConfig(async ({ locale }) => ({
      locale,
      messages: [
        'bad = price: { CURRENCY("abc") }',
        'badp = share: { PERCENT("n/a") }',
        'ok = price: { CURRENCY(12.5, currency: "EUR") }',
      ].join('\n'),
    }));
    const t = await getTranslations('en');
    // Formatting "abc" would be `NaN ₽` — the value belongs to the catalog
    // author, so it is returned untouched instead.
    assert.equal(stripIsolators(t('bad')), 'price: abc');
    assert.equal(stripIsolators(t('badp')), 'share: n/a');
    assert.equal(stripIsolators(t('ok')), 'price: €12.50');
  });
});
