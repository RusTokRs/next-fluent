/**
 * Audit pass 11 — see ENGINEERING_AUDIT_V11.md.
 *
 * Continues the V10 §9 work list. The first item on it, `watchCatalogs`, turned
 * out to be already covered (the V10 wording was wrong, not the code), so this
 * pass took the finding that list pointed at next: `catalog-io.js` has a branch
 * where `fs.readdirSync` fails and one where the watcher reports a failed
 * regeneration — and behind it, a difference between the two collectors in the
 * same file that nobody had noticed.
 *
 * Every finding is reproduced before it is fixed, and every fix has a test that
 * fails without it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { collectSourceFiles } from '../dist/catalog-io.js';
import { createFluentBundle, createTranslator } from '../dist/bundle.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(root, 'bin/next-fluent.mjs');

/**
 * Relative paths in '/'-separated form.
 *
 * `path.relative` answers with the platform separator, so on Windows the
 * expectations below would never match. Splitting on `path.sep` would be
 * untestable here — on Linux both forms are '/', so the mistake stays invisible
 * until CI runs on Windows — hence a separator-independent conversion that is
 * verified directly.
 */
function toPosix(relativePath) {
  return relativePath.split('\\').join('/');
}

/** A project tree the scenario fills in. */
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-srcwalk-'));
  return {
    dir,
    app: path.join(dir, 'app'),
    write: (relative, content) => {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      return target;
    },
    // Windows refuses to create symlinks without Developer Mode, so a link
    // that cannot be made is reported instead of thrown — the same guard the
    // catalog symlink tests use.
    link: (relative, target, type) => {
      try {
        fs.symlinkSync(target, path.join(dir, relative), type ?? 'file');
        return true;
      } catch {
        return false;
      }
    },
    // `path.relative` answers with the platform separator, and the expectations
    // below are written with '/', so normalize before comparing.
    scanned: () =>
      collectSourceFiles(path.join(dir, 'app'))
        .map((file) => toPosix(path.relative(dir, file)))
        .sort(),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Runs the CLI and returns its status and combined output. */
function runCli(cwd, args) {
  try {
    return { status: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }) };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

// ---------------------------------------------------------------------------
// V11-01. A symlinked source tree was invisible to `--usage`
// ---------------------------------------------------------------------------
// `collectCatalogFiles` was taught in V5 to classify symlinks instead of
// dropping them, and its own collector explicitly does not follow directory
// links — so that it cannot cycle. Its sibling in the same file, which finds the
// call sites of the very messages those catalogs hold, kept the `readdirSync`
// default: a symlink is neither `isFile()` nor `isDirectory()`, so every entry
// that was a link fell through both checks and disappeared.

test('a symlinked source file is scanned', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const a = 1');
    t.write('shared/Button.tsx', 'export const b = 1');
    if (!t.link('app/Button.tsx', path.join(t.dir, 'shared/Button.tsx'))) return;

    assert.deepEqual(t.scanned(), ['app/Button.tsx', 'app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('a symlinked source directory is scanned', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const a = 1');
    t.write('packages/ui/Button.tsx', 'export const b = 1');
    if (!t.link('app/components', path.join(t.dir, 'packages/ui'), 'dir')) return;

    assert.deepEqual(t.scanned(), [
      'app/components/Button.tsx',
      'app/page.tsx',
    ]);
  } finally {
    t.cleanup();
  }
});

test('a link that reaches its own ancestor does not loop forever', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const a = 1');
    if (!t.link('app/loop', t.dir, 'dir')) return;

    // The walk has to terminate; without cycle tracking this never returns.
    assert.deepEqual(t.scanned(), ['app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('the same directory behind two links is scanned once', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const a = 1');
    t.write('shared/Button.tsx', 'export const b = 1');
    if (!t.link('app/a', path.join(t.dir, 'shared'), 'dir')) return;
    if (!t.link('app/b', path.join(t.dir, 'shared'), 'dir')) return;

    // Scanning it twice would report its call sites as two places.
    assert.deepEqual(t.scanned(), ['app/a/Button.tsx', 'app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('the same file behind two links is collected once', () => {
  const t = tree();
  try {
    t.write('app/real.tsx', 'export const r = 1');
    if (!t.link('app/one.tsx', path.join(t.dir, 'app/real.tsx'))) return;
    if (!t.link('app/two.tsx', path.join(t.dir, 'app/real.tsx'))) return;

    assert.deepEqual(t.scanned(), ['app/one.tsx']);
  } finally {
    t.cleanup();
  }
});

test('a broken link is skipped instead of throwing', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const p = 1');
    if (!t.link('app/dangling.tsx', path.join(t.dir, 'gone.tsx'))) return;
    if (!t.link('app/dir-dangling', path.join(t.dir, 'nowhere'), 'dir')) return;

    assert.deepEqual(t.scanned(), ['app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('following links does not start walking node_modules', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const p = 1');
    t.write('deps/node_modules/pkg/index.js', 'module.exports = 1');
    if (!t.link('app/deps', path.join(t.dir, 'deps'), 'dir')) return;

    assert.deepEqual(t.scanned(), ['app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('check --usage does not call a message dead when it is used behind a link', () => {
  const t = tree();
  try {
    t.write('messages/en.ftl', 'in-page = In page\nfrom-shared = From shared\n');
    t.write('messages/ru.ftl', 'in-page = В странице\nfrom-shared = Из общего\n');
    t.write(
      'app/page.tsx',
      "import { getTranslations } from 'next-fluent/server';\n" +
        'export default async function P() {\n' +
        '  const t = await getTranslations();\n' +
        "  return t('in-page');\n" +
        '}\n'
    );
    t.write('packages/ui/Button.tsx', "export default function B({ t }) {\n  return t('from-shared');\n}\n");
    if (!t.link('app/components', path.join(t.dir, 'packages/ui'), 'dir')) return;

    const { status, output } = runCli(t.dir, ['check', '--input', 'messages', '--src', 'app', '--usage']);
    assert.equal(status, 0, output);
    assert.match(output, /2\/2 keys used/, output);
    assert.doesNotMatch(
      output,
      /"from-shared" is defined in en but never referenced/,
      'a live message reported as dead is the false positive this fixes'
    );

    // And with --strict-usage, which turns that false positive into a failed build.
    const strict = runCli(t.dir, [
      'check',
      '--input',
      'messages',
      '--src',
      'app',
      '--usage',
      '--strict-usage',
    ]);
    assert.equal(strict.status, 0, strict.output);
  } finally {
    t.cleanup();
  }
});
// ---------------------------------------------------------------------------
// V11-02. A message used in a `.mts` or `.mdx` file looked dead
// ---------------------------------------------------------------------------
// The extension list was written when `.mjs`/`.cjs` were the newest additions and
// never revisited. `.mts`/`.cts` are what TypeScript calls its ESM/CJS modules,
// and `.mdx` is a first-party Next plugin — both hold real call sites, and both
// were invisible, so `check --usage` accused live messages of being unused.

test('every source flavour TypeScript and Next can ship is scanned', () => {
  const t = tree();
  try {
    for (const name of ['page.tsx', 'page.jsx', 'page.js', 'page.mjs', 'page.cjs', 'server.mts', 'worker.cts', 'page.mdx']) {
      t.write(`app/${name}`, "t('x');\n");
    }
    assert.deepEqual(t.scanned(), [
      'app/page.cjs',
      'app/page.js',
      'app/page.jsx',
      'app/page.mdx',
      'app/page.mjs',
      'app/page.tsx',
      'app/server.mts',
      'app/worker.cts',
    ]);
  } finally {
    t.cleanup();
  }
});

test('declaration files are skipped in every TypeScript flavour', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', "t('real');\n");
    t.write('app/globals.d.ts', "declare const x: 1;\n");
    t.write('app/module.d.mts', "declare const y: 1;\n");
    t.write('app/other.d.cts', "declare const z: 1;\n");

    assert.deepEqual(t.scanned(), ['app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('check --usage finds a message used from an .mts module and an .mdx page', () => {
  const t = tree();
  try {
    t.write('messages/en.ftl', 'in-tsx = A\nin-mts = B\nin-mdx = C\n');
    t.write('messages/ru.ftl', 'in-tsx = А\nin-mts = Б\nin-mdx = В\n');
    t.write('app/page.tsx', "export default function P({ t }) {\n  return t('in-tsx');\n}\n");
    t.write('app/server.mts', "export function S({ t }) {\n  return t('in-mts');\n}\n");
    t.write(
      'app/about.mdx',
      "import { useTranslations } from 'next-fluent/client';\n\n" +
        '# About\n\nProse mentioning `t("in-mdx")` without calling it.\n\n' +
        "export const cta = ({ t }) => t('in-mdx');\n"
    );

    const { status, output } = runCli(t.dir, ['check', '--input', 'messages', '--src', 'app', '--usage']);
    assert.equal(status, 0, output);
    assert.match(output, /3\/3 keys used/, output);
  } finally {
    t.cleanup();
  }
});

test('a declaration file cannot make a dead message look alive', () => {
  const t = tree();
  try {
    t.write('messages/en.ftl', 'declared = D\n');
    t.write('messages/ru.ftl', 'declared = Д\n');
    t.write('app/types.d.mts', "declare module 'virtual' {\n  export function t(key: 'declared'): string;\n}\n");

    const { status, output } = runCli(t.dir, ['check', '--input', 'messages', '--src', 'app', '--usage']);
    assert.equal(status, 0, output);
    assert.match(output, /0\/1 keys used/, output);
  } finally {
    t.cleanup();
  }
});

// ---------------------------------------------------------------------------
// V11-03. The watcher's own failure paths
// ---------------------------------------------------------------------------
// `watchCatalogs` is the one subsystem of this file that runs while somebody
// edits, so its error paths are the ones that meet a human mid-sentence. Probed
// by hand and correct; locked in here because nothing covered them.

test('the watcher reports a broken catalog and recovers when it is fixed', async () => {
  const { watchCatalogs } = await import('../dist/catalog-io.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-watch-'));
  try {
    const catalog = path.join(dir, 'en.ftl');
    const output = path.join(dir, 'types', 'fluent.d.ts');
    fs.writeFileSync(catalog, 'good = Fine\n');

    const events = [];
    const stop = watchCatalogs(dir, output, {
      onUpdate: (result) => events.push(`update:${result.changed}`),
      onError: (error) => events.push(`error:${error.message.split('\n')[0]}`),
    });
    // A loaded runner delivers the event late, and `fs.watch` may report one
    // write as several events; wait for what matters instead of a fixed sleep.
    const until = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return predicate();
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      // A half-saved file is the normal case, not an edge case.
      fs.writeFileSync(catalog, 'good = Fine\nbroken = {\n');
      assert.ok(await until(() => events.some((e) => e.startsWith('error:'))), events.join('\n'));
      assert.ok(events.every((e) => e.startsWith('error:')), events.join('\n'));
      assert.match(events[0], /cannot read/);

      events.length = 0;
      fs.writeFileSync(catalog, 'good = Fine\nfixed = Yes\n');
      assert.ok(await until(() => events.length > 0), 'the watcher stayed quiet after the fix');
      assert.ok(events.every((e) => e === 'update:true'), events.join('\n'));
      assert.match(fs.readFileSync(output, 'utf8'), /'fixed'/);
    } finally {
      stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scanner does not walk into a directory it is told to skip', () => {
  const t = tree();
  try {
    t.write('app/page.tsx', 'export const a = 1');
    for (const skipped of ['node_modules', '.next', 'dist', '.git', 'coverage']) {
      t.write(`app/${skipped}/thing.js`, 'module.exports = 1');
    }
    assert.deepEqual(t.scanned(), ['app/page.tsx']);
  } finally {
    t.cleanup();
  }
});

test('the path conversion the assertions rely on is separator-independent', () => {
  // Whatever the platform reports, the expectations in this file are written
  // with '/'. Checking the conversion directly keeps that guarantee verifiable
  // on a machine whose separator is already '/'.
  assert.equal(toPosix('app/page.tsx'), 'app/page.tsx');
  assert.equal(toPosix('app\\page.tsx'), 'app/page.tsx');
  assert.equal(toPosix('a\\b\\c.tsx'), 'a/b/c.tsx');
  assert.equal(toPosix('/already/posix.tsx'), '/already/posix.tsx');
});

// ---------------------------------------------------------------------------
// V12-01. A public error code the library can never report
// ---------------------------------------------------------------------------
// `FluentErrorCode` is exported for applications to switch on, and one of its
// five members — `ENVIRONMENT_FALLBACK`, documented in the source as "a less
// specific locale had to be used for the request" — was never produced
// anywhere: not by the translator, not by the formatter, not by the middleware.
// The library does resolve a message from a less specific locale, silently and
// correctly; it simply never said so, while the enum advertised that it would.
//
// Reporting it was not a small fix: every ordinary `en-GB` request that finds
// its message in `en` would have to be announced, which is the library's normal
// operation rather than a fault. So the code is gone instead, and the gate
// below is what keeps the public surface from drifting away from the behaviour
// again.

test('every public error code is one the library actually reports', async () => {
  const { FluentErrorCode } = await import('../dist/errors.js');
  const source = await fs.promises.readFile(
    path.join(root, 'src/errors.ts'),
    'utf8'
  );
  // Everything except the declaration file itself.
  const producers = await fs.promises.readFile(
    path.join(root, 'src/bundle.ts'),
    'utf8'
  );

  const codes = Object.values(FluentErrorCode);
  assert.ok(codes.length >= 4, 'the error codes were removed along with the message text');

  for (const code of codes) {
    assert.match(
      source,
      new RegExp(`case FluentErrorCode\\.${code}:`),
      `${code} has no message of its own`
    );
    assert.ok(
      producers.includes(`FluentErrorCode.${code}`),
      `${code} is public but nothing outside src/errors.ts ever reports it`
    );
  }
});

test('every error code names its key, and its locale when there is one', async () => {
  const { FluentError, FluentErrorCode } = await import('../dist/errors.js');
  const expected = {
    [FluentErrorCode.MISSING_MESSAGE]: 'Missing message "nav.home"',
    [FluentErrorCode.FORMATTING_ERROR]: 'Could not format message "nav.home"',
    [FluentErrorCode.INVALID_ARGUMENT]: 'Invalid argument for message "nav.home"',
    [FluentErrorCode.UNSUPPORTED_VALUE]: 'Unsupported value for message "nav.home"',
  };

  for (const [code, prefix] of Object.entries(expected)) {
    const error = new FluentError({ code, key: 'home', namespace: 'nav' });
    assert.equal(error.message, `[next-fluent] ${prefix}`);
    assert.equal(error.path, 'nav.home');

    const withLocale = new FluentError({ code, key: 'home', namespace: 'nav', locale: 'ru' });
    assert.equal(withLocale.message, `[next-fluent] ${prefix} (locale: ru)`);
  }
});

test('a key with no namespace is reported by itself', async () => {
  const { FluentError, FluentErrorCode } = await import('../dist/errors.js');
  const error = new FluentError({ code: FluentErrorCode.MISSING_MESSAGE, key: 'title' });
  assert.equal(error.message, '[next-fluent] Missing message "title"');
  assert.equal(error.path, 'title');
});

test('an unknown code still produces a message instead of undefined', async () => {
  const { FluentError } = await import('../dist/errors.js');
  // Plain JavaScript can pass anything; the contract is a string.
  const error = new FluentError({ code: 'SOMETHING_ELSE', key: 'title' });
  assert.equal(error.message, '[next-fluent] Localization error for "title"');
  assert.equal(typeof error.message, 'string');
});

// ---------------------------------------------------------------------------
// V12-02. What an error actually carries
// ---------------------------------------------------------------------------
// `onError` hands the application a `FluentError`, and four places in the
// library attach a `cause` to it: two in the translator, two in `t.attrs()`.
// None of them had a test, and nothing documented the shape, so an application
// writing a handler had no way to find out what it receives.

/** Translates `messages` and returns every error the handler was given. */
function collectErrors(messages, run, options = {}) {
  const seen = [];
  const t = createTranslator(createFluentBundle('en', messages), {
    onError: (error) => seen.push(error),
    getMessageFallback: () => '<fallback>',
    ...options,
  });
  run(t);
  return seen;
}

test('a formatting error carries the Fluent error that stopped it', () => {
  const seen = collectErrors('greet = Hi { $name }', (t) => t('greet'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, 'FORMATTING_ERROR');
  assert.ok(Array.isArray(seen[0].cause), 'the cause is the list Fluent collected');
  assert.match(seen[0].cause[0].message, /Unknown variable: \$name/);
  // Without it, the message says only "could not format" and names no reason.
  assert.equal(seen[0].message, '[next-fluent] Could not format message "greet" (locale: en)');
});

test('an invalid argument names the arguments it could not use', () => {
  const seen = collectErrors('greet = Hi { $name }', (t) => t('greet', { name: null }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, 'INVALID_ARGUMENT');
  assert.deepEqual(seen[0].cause.unsupportedArguments, ['name'], 'the rejected keys are named');
  assert.ok(Array.isArray(seen[0].cause.errors));
  assert.match(seen[0].cause.errors[0].message, /Unknown variable: \$name/);
});

test('an argument the library cannot turn into a Fluent value is named too', () => {
  const seen = collectErrors('greet = Hi { $name }', (t) =>
    t('greet', { name: { deep: { nested: true } } })
  );
  assert.equal(seen[0].code, 'INVALID_ARGUMENT');
  assert.deepEqual(seen[0].cause.unsupportedArguments, ['name']);
});

test('t.attrs() reports the same way and renders nothing rather than throwing', () => {
  const seen = collectErrors(
    'field = Name\n    .placeholder = Your { $name }\n',
    (t) => {
      const attrs = t.attrs('field');
      assert.deepEqual(attrs, {}, 'a failed attribute set spreads to nothing');
    }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, 'FORMATTING_ERROR');
  assert.ok(Array.isArray(seen[0].cause));
  assert.match(seen[0].cause[0].message, /Unknown variable: \$name/);
  assert.equal(seen[0].message, '[next-fluent] Could not format message "field" (locale: en)');
});

test('a function in defaultTranslationValues does not reach the client', async () => {
  const React = (await import('react')).default;
  // `FluentServerProvider` is async and suspends, so it needs the suspending
  // renderer rather than `renderToStaticMarkup`.
  const { prerender } = await import('react-dom/static');
  const { FluentServerProvider } = await import('../dist/server-provider.js');
  const { useTranslations } = await import('../dist/client.js');
  const { setRequestConfig, getRequestConfig } = await import('../dist/server.js');

  // React cannot serialize a function across the RSC boundary, so the provider
  // drops them. Node renders neither half of that boundary, which is why the
  // filter itself is asserted against the source and the outcome against the
  // render: a function in the config must not break the tree, and the plain
  // values beside it must still reach the messages.
  const source = await fs.promises.readFile(
    path.join(root, 'src/server-provider.ts'),
    'utf8'
  );
  assert.match(source, /typeof value !== 'function'/);

  const previous = getRequestConfig();
  setRequestConfig(async ({ locale }) => ({
    locale,
    messages: 'greet = Hi { $who }\n',
    defaultTranslationValues: { who: 'World', later: () => 'unused' },
  }));
  try {
    const Child = () => {
      const t = useTranslations();
      return React.createElement('span', null, t('greet'));
    };
    const { prelude } = await prerender(
      React.createElement(FluentServerProvider, { locale: 'en' }, React.createElement(Child))
    );
    const decoder = new TextDecoder();
    let html = '';
    for await (const chunk of prelude) html += decoder.decode(chunk, { stream: true });
    // Fluent isolates interpolated values with U+2068/U+2069; that is
    // presentation, not content.
    assert.match(html.replace(/[\u2066-\u2069]/g, ''), /Hi World/);
  } finally {
    if (previous) setRequestConfig(previous);
  }
});

// ---------------------------------------------------------------------------
// V12-03. The diagnostics themselves
// ---------------------------------------------------------------------------
// The parser's own reporting — what it says about a catalog it could not read —
// is the first thing an author sees when a file has a typo, and none of its
// branches were exercised: junk without a key in front of it, one entry against
// several, and the provider's own defaults.

test('junk the parser cannot attribute to a key is still reported', async () => {
  const { junkEntries, parseFtl } = await import('../dist/ftl-parse.js');
  // A stray brace is junk with no `key =` in front of it, so there is no id to
  // name — which must not make the entry disappear.
  assert.deepEqual(junkEntries(parseFtl('ok = Fine\n}\n', 'test')), [{ id: undefined, snippet: '}' }]);
  assert.deepEqual(junkEntries(parseFtl('ok = Fine\n= orphan\n', 'test')), [
    { id: undefined, snippet: '= orphan' },
  ]);
  // A key the parser did read keeps its name.
  assert.deepEqual(junkEntries(parseFtl('ok = Fine\n}\nbroken = {\n', 'test')), [
    { id: undefined, snippet: '}' },
    { id: 'broken', snippet: 'broken = {' },
  ]);
});

test('an unparsable catalog counts entries the way a person reads them', async () => {
  const { unparsableCatalogError } = await import('../dist/ftl-parse.js');
  const one = unparsableCatalogError([{ id: undefined, snippet: '}' }], 'messages/en.ftl');
  assert.match(one.message, /contains 1 entry the Fluent parser cannot read: "}"/);
  assert.equal(one.key, '<catalog>', 'with no key of its own, the catalog is named instead');

  const named = unparsableCatalogError([{ id: 'broken', snippet: 'broken = {' }], 'messages/en.ftl');
  assert.equal(named.key, 'broken', 'a single named entry can be named');

  const several = unparsableCatalogError(
    [
      { id: undefined, snippet: '}' },
      { id: 'broken', snippet: 'broken = {' },
    ],
    'messages/en.ftl'
  );
  assert.match(several.message, /contains 2 entries .*: "}"; "broken = \{"/);
  assert.equal(several.key, '<catalog>');
});

test('the provider renders with no default translation values at all', async () => {
  const React = (await import('react')).default;
  const { prerender } = await import('react-dom/static');
  const { FluentServerProvider } = await import('../dist/server-provider.js');
  const { useTranslations } = await import('../dist/client.js');
  const { setRequestConfig, getRequestConfig } = await import('../dist/server.js');

  const previous = getRequestConfig();
  setRequestConfig(async ({ locale }) => ({ locale, messages: 'greet = Hi\n' }));
  try {
    const Child = () => React.createElement('span', null, useTranslations()('greet'));
    const { prelude } = await prerender(
      React.createElement(FluentServerProvider, { locale: 'en' }, React.createElement(Child))
    );
    const decoder = new TextDecoder();
    let html = '';
    for await (const chunk of prelude) html += decoder.decode(chunk, { stream: true });
    assert.match(html, /Hi/);
  } finally {
    if (previous) setRequestConfig(previous);
  }
});
