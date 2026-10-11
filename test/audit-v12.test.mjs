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

const root = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(root, 'bin/next-fluent.mjs');

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
    scanned: () =>
      collectSourceFiles(path.join(dir, 'app'))
        .map((file) => path.relative(dir, file))
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
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      // A half-saved file is the normal case, not an edge case.
      fs.writeFileSync(catalog, 'good = Fine\nbroken = {\n');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(events.length, 1, events.join('\n'));
      assert.match(events[0], /^error:/);
      assert.match(events[0], /cannot read/);

      events.length = 0;
      fs.writeFileSync(catalog, 'good = Fine\nfixed = Yes\n');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.deepEqual(events, ['update:true']);
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
