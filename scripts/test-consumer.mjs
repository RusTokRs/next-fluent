/**
 * Consumer contract test.
 *
 * Everything else in this suite runs against the repository: `dist/` files by
 * relative path, or an app living inside the repo. None of that proves a real
 * project can *install and use* the package — that only `exports`, the file
 * layout and the shipped types can decide. This script builds a throwaway
 * consumer, installs next-fluent into it the way npm would, and checks:
 *
 *   1. every documented entry point resolves and exports what the README claims
 *   2. every bare import in `dist/` is a declared dependency
 *   3. a CommonJS `next.config.js` works — Next.js configs are CJS by default,
 *      and `require()` of an ESM module returns a namespace, not the factory
 *   4. an ESM `next.config.mjs` works
 *   5. both module systems typecheck, including the `.d.cts` for the CJS entry
 *
 * Run with `npm run test:consumer`; wired into `npm run ci`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

let failures = 0;
const ok = (label, detail = '') => console.log(`  \u2713 ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};

/** Entry points a consumer can import, as package specifiers. */
const entrySpecifiers = Object.keys(pkg.exports)
  .filter((key) => key !== './package.json')
  .map((key) => (key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`));

// ---------------------------------------------------------------------------
// 1. Every bare import in dist/ must be a declared dependency
// ---------------------------------------------------------------------------
console.log('\n[next-fluent] declared dependencies');
{
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const bare = new Map();
  const files = [];
  for (const name of await readdir(path.join(root, 'dist'))) {
    const full = path.join(root, 'dist', name);
    if (name.endsWith('.js')) files.push(full);
    else if (name === 'cjs') {
      for (const cjs of await readdir(full)) {
        if (cjs.endsWith('.cjs')) files.push(path.join(full, cjs));
      }
    }
  }
  for (const file of files) {
    // Strip whole-line and block comments first: prose such as
    // "a `next.config.js` calls `require('next-fluent/plugin')`" is not an
    // import. Only full-line comments are removed, so strings stay intact.
    const code = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    for (const [, spec] of code.matchAll(
      /(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"./][^'"]*)['"]/g
    )) {
      if (spec.startsWith('node:')) continue;
      // Keep the full specifier for self-references so an unexpected one shows up.
      const isSelf = spec === pkg.name || spec.startsWith(`${pkg.name}/`);
      const name = isSelf
        ? spec
        : spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
      if (!bare.has(name)) bare.set(name, new Set());
      bare.get(name).add(path.basename(file));
    }
  }
  // The package refers to itself through `next-fluent/config`, a virtual module
  // the plugin aliases to the app's request config. Anything else self-imported
  // would be a mistake, so only that one specifier is allowed.
  for (const key of [...bare.keys()].filter((k) => k === pkg.name || k.startsWith(`${pkg.name}/`))) {
    const where = bare.get(key);
    bare.delete(key);
    if (key === `${pkg.name}/config`) {
      ok(`${key} (virtual)`, `aliased by the plugin; used by ${[...where].join(', ')}`);
    } else {
      bad(key, `self-import by ${[...where].join(', ')}; only ${pkg.name}/config is virtual`);
    }
  }
  for (const [name, where] of [...bare].sort()) {
    if (declared.has(name)) ok(name, `used by ${[...where].slice(0, 3).join(', ')}`);
    else bad(name, `imported by ${[...where].join(', ')} but absent from dependencies`);
  }
}

// ---------------------------------------------------------------------------
// Build the throwaway consumer
// ---------------------------------------------------------------------------
const consumer = await mkdtemp(path.join(tmpdir(), 'next-fluent-consumer-'));
const modules = path.join(consumer, 'node_modules');
await mkdir(modules, { recursive: true });

// Link the package itself plus the peers and type packages the app entries need.
// `@fluent/*` resolves through the linked package's own node_modules, which is
// how a real install behaves for transitive dependencies.
await symlink(root, path.join(modules, pkg.name), 'dir');
for (const dep of ['next', 'react', 'react-dom', '@types/react', '@types/node']) {
  const from = path.join(root, 'node_modules', dep);
  await mkdir(path.dirname(path.join(modules, dep)), { recursive: true });
  await symlink(from, path.join(modules, dep), 'dir');
}

await writeFile(
  path.join(consumer, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true }, null, 2)
);
await mkdir(path.join(consumer, 'src/i18n'), { recursive: true });
await writeFile(
  path.join(consumer, 'src/i18n/request.ts'),
  `export const locales = ['en', 'ru'] as const;\n`
);

try {
  // -------------------------------------------------------------------------
  // 2. Entry points resolve at runtime, from a consumer's perspective
  // -------------------------------------------------------------------------
  console.log('\n[next-fluent] entry points (ESM, from a consumer)');
  const expected = {
    [pkg.name]: ['FluentProvider', 'useTranslations', 'defineRouting', 'createNavigation', 'createTranslator'],
    [`${pkg.name}/client`]: ['FluentProvider'],
    [`${pkg.name}/server`]: ['getTranslations', 'configureServerI18n'],
    [`${pkg.name}/middleware`]: ['createI18nMiddleware'],
    [`${pkg.name}/navigation`]: ['createNavigation'],
    [`${pkg.name}/routing`]: ['defineRouting'],
    [`${pkg.name}/plugin`]: ['createNextFluentPlugin'],
    [`${pkg.name}/usage`]: ['analyzeUsage'],
    [`${pkg.name}/check`]: ['checkCatalogs'],
  };
  for (const spec of entrySpecifiers) {
    // A query string would become part of the subpath and fail `exports`
    // resolution, so each specifier is imported exactly as a consumer writes it.
    try {
      const mod = await import(spec);
      const names = expected[spec];
      if (!names) {
        ok(spec, `${Object.keys(mod).length} exports`);
        continue;
      }
      const missing = names.filter((name) => typeof mod[name] === 'undefined');
      if (missing.length) bad(spec, `missing exports: ${missing.join(', ')}`);
      else ok(spec, names.join(', '));
    } catch (error) {
      bad(spec, `${error.code ?? error.name}: ${String(error.message).split('\n')[0]}`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. CommonJS next.config.js — the default Next.js config format
  // -------------------------------------------------------------------------
  console.log('\n[next-fluent] next.config.js (CommonJS)');
  {
    const configPath = path.join(consumer, 'next.config.js');
    await writeFile(
      configPath,
      `const createNextFluentPlugin = require('next-fluent/plugin');\n` +
        `const withNextFluent = createNextFluentPlugin();\n` +
        `module.exports = withNextFluent({ reactStrictMode: true });\n`
    );
    const result = spawnSync(
      process.execPath,
      ['-e', `const c = require(${JSON.stringify(configPath)});
const out = c.webpack({ resolve: { alias: {} }, plugins: [] }, { isServer: true, dev: false, dir: ${JSON.stringify(consumer)}, nextRuntime: 'nodejs' });
console.log(JSON.stringify({ keys: Object.keys(c), alias: out.resolve.alias['next-fluent/config'] }));`],
      { cwd: consumer, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      bad('require(\'next-fluent/plugin\') is callable', result.stderr.trim().split('\n').slice(0, 4).join(' | '));
    } else {
      const parsed = JSON.parse(result.stdout.trim());
      if (!parsed.keys.includes('webpack') || !parsed.keys.includes('turbopack')) {
        bad('plugin wired both bundlers', `config keys: ${parsed.keys.join(', ')}`);
      } else if (parsed.alias !== path.join(consumer, 'src/i18n/request.ts')) {
        // The CJS build has to resolve the *consumer's* request config, which is
        // what the `import.meta.url` -> `__filename` shim is for.
        bad('alias points at the consumer project', `got ${parsed.alias}`);
      } else {
        ok('require(\'next-fluent/plugin\') is callable');
        ok('webpack + turbopack wired', parsed.keys.join(', '));
        ok('alias resolves inside the consumer', parsed.alias);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. ESM next.config.mjs must keep working
  // -------------------------------------------------------------------------
  console.log('\n[next-fluent] next.config.mjs (ESM)');
  {
    const configPath = path.join(consumer, 'next.config.mjs');
    await writeFile(
      configPath,
      `import createNextFluentPlugin from 'next-fluent/plugin';\n` +
        `export default createNextFluentPlugin()({ reactStrictMode: true });\n`
    );
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `const c = (await import(${JSON.stringify(`file://${configPath}`)})).default;
console.log(JSON.stringify(Object.keys(c)));`],
      { cwd: consumer, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      bad('ESM default import', result.stderr.trim().split('\n').slice(0, 3).join(' | '));
    } else {
      const keys = JSON.parse(result.stdout.trim());
      if (keys.includes('webpack') && keys.includes('turbopack')) ok('ESM default import', keys.join(', '));
      else bad('plugin wired both bundlers', `config keys: ${keys.join(', ')}`);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Types, under NodeNext, for both module systems
  // -------------------------------------------------------------------------
  console.log('\n[next-fluent] shipped types (module: nodenext)');
  {
    await writeFile(
      path.join(consumer, 'app.mts'),
      `import createNextFluentPlugin from 'next-fluent/plugin';\n` +
        `import { defineRouting } from 'next-fluent/routing';\n` +
        `import { createI18nMiddleware } from 'next-fluent/middleware';\n` +
        `import { getTranslations } from 'next-fluent/server';\n\n` +
        `const routing = defineRouting({ locales: ['en', 'ru'], defaultLocale: 'en' });\n` +
        `const middleware = createI18nMiddleware(routing);\n` +
        `const withNextFluent: ReturnType<typeof createNextFluentPlugin> = createNextFluentPlugin();\n\n` +
        `export default withNextFluent({ reactStrictMode: true });\n` +
        `export { middleware };\n` +
        `export async function render(locale: 'en' | 'ru') {\n` +
        `  const t = await getTranslations({ locale });\n` +
        `  return t('greeting');\n` +
        `}\n`
    );
    // `import x = require(...)` is the CJS form; it only typechecks if
    // plugin.d.cts is present and uses `export =`.
    await writeFile(
      path.join(consumer, 'config.cts'),
      `import createNextFluentPlugin = require('next-fluent/plugin');\n\n` +
        `const withNextFluent = createNextFluentPlugin('./src/i18n/request.ts', {\n` +
        `  typegen: { watch: false },\n` +
        `});\n\n` +
        `module.exports = withNextFluent({ reactStrictMode: true });\n`
    );
    const tsconfig = {
      compilerOptions: {
        strict: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        jsx: 'preserve',
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['app.mts', 'config.cts'],
    };
    await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
    const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
    const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
      cwd: consumer,
      encoding: 'utf8',
    });
    if (result.status === 0) ok('ESM .mts and CJS .cts both typecheck');
    else bad('consumer typecheck', (result.stdout + result.stderr).trim().split('\n').slice(0, 6).join('\n      '));

    // Negative control: the harness above must actually be able to fail, or a
    // green run proves nothing.
    await writeFile(
      path.join(consumer, 'broken.mts'),
      `import { defineRouting } from 'next-fluent/routing';\n` +
        `defineRouting({ locales: ['en'], defaultLocale: 'de' });\n`
    );
    const negative = spawnSync(
      process.execPath,
      [tsc, '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--noEmit', '--skipLibCheck', 'broken.mts'],
      { cwd: consumer, encoding: 'utf8' }
    );
    if (negative.status !== 0) ok('negative control still fails', 'defaultLocale outside locales');
    else bad('negative control', 'an invalid config typechecked, so the checks above are vacuous');
  }
} finally {
  await rm(consumer, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? '\n[next-fluent] Consumer contract verified.\n'
    : `\n[next-fluent] ${failures} consumer check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
