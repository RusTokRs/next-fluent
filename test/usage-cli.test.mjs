import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI = path.resolve('bin/next-fluent.mjs');

const EN = `hello = Hello
checkout-title = Checkout
login = Sign in
    .placeholder = Email
orphan-key = Nobody renders me
`;
const RU = `hello = Привет
checkout-title = Оплата
login = Войти
    .placeholder = Почта
orphan-key = Никто не рендерит
`;

/**
 * Creates a throwaway project: two locales plus `app/page.tsx`.
 * Returns helpers for running the CLI, since exit codes are part of the
 * contract and `execFileSync` throws on non-zero.
 */
function project(pageSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-usage-'));
  fs.mkdirSync(path.join(dir, 'messages'));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'messages/en.ftl'), EN);
  fs.writeFileSync(path.join(dir, 'messages/ru.ftl'), RU);
  fs.writeFileSync(path.join(dir, 'app/page.tsx'), pageSource);

  const run = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], {
        cwd: dir,
        encoding: 'utf8',
      });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };

  return {
    dir,
    run,
    check: (extra = []) =>
      run(['check', '--input', 'messages', '--src', 'app', '--usage', ...extra]),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('a key used in code but missing from the catalog fails the command', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\nt('typo-key');\n");
  t.after(p.cleanup);
  const { status, stdout } = p.check();
  assert.equal(status, 1);
  assert.match(stdout, /missing \(1\)/);
  assert.match(stdout, /"typo-key"/);
});

test('advisories alone do not fail the command', (t) => {
  // Everything referenced exists; only `orphan-key` and `login.placeholder`
  // are unused, which is advisory by default.
  const p = project("const t = useTranslations('checkout');\nconst b = useTranslations();\nt('title');\nb('hello');\n");
  t.after(p.cleanup);
  const { status, stdout } = p.check();
  assert.equal(status, 0, `expected success, got:\n${stdout}`);
  // `login`, `login.placeholder` and `orphan-key` are never referenced.
  assert.match(stdout, /unused \(3\)/);
});

test('--strict-usage escalates advisories to a failure', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\n");
  t.after(p.cleanup);
  assert.equal(p.check().status, 0);
  assert.equal(p.check(['--strict-usage']).status, 1);
});

test('--allow-unused drops the dead-key report', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\n");
  t.after(p.cleanup);
  const { stdout } = p.check(['--allow-unused']);
  assert.ok(!stdout.includes('unused ('), `unexpected unused report:\n${stdout}`);
  assert.match(stdout, /1\/5 keys used/);
});

test('--ignore-unused exempts a namespace', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\n");
  t.after(p.cleanup);
  const { stdout } = p.check(['--ignore-unused', 'orphan']);
  assert.ok(!stdout.includes('"orphan-key"'), `orphan-key still reported:\n${stdout}`);
  // `checkout-title`, `login` and `login.placeholder` remain.
  assert.match(stdout, /unused \(3\)/);
});

test('--json emits a machine-readable usage report', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\nt('nope');\nt(other);\n");
  t.after(p.cleanup);
  const { status, stdout } = p.check(['--json']);
  assert.equal(status, 1);
  const parsed = JSON.parse(stdout);
  // Locale consistency and usage share one document.
  assert.equal(parsed.referenceLocale, 'en');
  assert.ok(Array.isArray(parsed.issues), 'catalog issues missing');
  assert.equal(parsed.usage.dynamicSites, 1);
  assert.deepEqual(parsed.usage.usedKeys, ['hello']);
  assert.deepEqual(
    parsed.usage.issues.filter((issue) => issue.kind === 'missing').map((issue) => issue.key),
    ['nope']
  );
});

test('a dynamic call site is reported with its location', (t) => {
  const p = project("const t = useTranslations();\nconst key = pick();\nt(key);\n");
  t.after(p.cleanup);
  const { stdout } = p.check();
  assert.match(stdout, /dynamic \(1\)/);
  assert.match(stdout, /app[\\/]page\.tsx:3/);
});

test('--usage without a source directory fails with guidance', (t) => {
  const p = project("const t = useTranslations();\n");
  t.after(p.cleanup);
  // The probe looks for app/src/pages/components — remove it so there is none.
  fs.rmSync(path.join(p.dir, 'app'), { recursive: true, force: true });
  const { status, stdout } = p.run(['check', '--input', 'messages', '--usage']);
  assert.equal(status, 1);
  assert.match(stdout, /--usage needs a source directory/);
});

test('the source directory is probed when --src is omitted', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\n");
  t.after(p.cleanup);
  // `app/` exists in the fixture project, so no --src is needed.
  const { status, stdout } = p.run(['check', '--input', 'messages', '--usage']);
  assert.equal(status, 0, `expected success, got:\n${stdout}`);
  assert.match(stdout, /keys used/);
});

test('usage analysis works with a single locale', (t) => {
  const p = project("const t = useTranslations();\nt('hello');\n");
  t.after(p.cleanup);
  fs.rmSync(path.join(p.dir, 'messages/ru.ftl'));
  const { status, stdout } = p.check();
  assert.equal(status, 0, `expected success, got:\n${stdout}`);
  assert.match(stdout, /Usage against en/);
});

test('a flag without a value says so instead of blaming the flag', (t) => {
  const p = project("const t = useTranslations();\n");
  t.after(p.cleanup);
  for (const flag of ['--input', '--reference', '--src', '--ignore-unused']) {
    const { status, stdout } = p.run(['check', flag]);
    assert.equal(status, 1, `${flag} should fail`);
    assert.match(stdout, new RegExp(`"${flag}" requires a value`), `${flag}: ${stdout.split('\n')[0]}`);
    assert.ok(!stdout.includes('Unknown option'), `${flag} was reported as unknown`);
  }
});

test('a catalog too deeply nested for the parser reports the cause', (t) => {
  const p = project("const t = useTranslations();\n");
  t.after(p.cleanup);
  const braces = '{'.repeat(4000) + '}'.repeat(4000);
  fs.writeFileSync(path.join(p.dir, 'messages/en.ftl'), `a = ${braces}\n`);
  const { status, stdout } = p.run(['check', '--input', 'messages']);
  assert.equal(status, 1);
  assert.match(stdout, /nested too deeply for the FTL parser/);
  assert.ok(!stdout.includes('Maximum call stack size exceeded'), 'raw stack overflow leaked');
  assert.ok(!stdout.includes('at '), 'a stack trace leaked into the report');
});

test('a broken JSON catalog names the file that failed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-catalog-'));
  try {
    fs.writeFileSync(path.join(dir, 'en.json'), '{ "a": ');
    const { readCatalog } = await import('../dist/catalog-io.js');
    let message = '';
    try {
      readCatalog(path.join(dir, 'en.json'));
    } catch (error) {
      message = error.message;
    }
    assert.match(message, /Cannot read the catalog/);
    assert.ok(message.includes('en.json'), `file name missing: ${message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked catalog is collected instead of silently dropped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-sym-'));
  const real = path.join(dir, 'real');
  const linked = path.join(dir, 'linked');
  try {
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(linked, { recursive: true });
    fs.writeFileSync(path.join(real, 'en.ftl'), 'a = A\n');
    let skipped = false;
    try {
      fs.symlinkSync(path.join(real, 'en.ftl'), path.join(linked, 'en.ftl'));
    } catch {
      skipped = true;
    }
    const { collectCatalogFiles } = await import('../dist/catalog-io.js');
    if (skipped) {
      assert.deepEqual(collectCatalogFiles(linked), []);
      return;
    }
    assert.equal(collectCatalogFiles(linked).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory symlink cannot make catalog collection recurse forever', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-symdir-'));
  try {
    fs.mkdirSync(path.join(dir, 'inner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'inner', 'en.ftl'), 'a = A\n');
    try {
      fs.symlinkSync(path.join(dir, 'inner'), path.join(dir, 'inner', 'loop'));
    } catch {
      return; // symlinks unavailable
    }
    const { collectCatalogFiles } = await import('../dist/catalog-io.js');
    // Must terminate, and must not follow the linked directory.
    assert.equal(collectCatalogFiles(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
