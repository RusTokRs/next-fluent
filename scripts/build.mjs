import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const srcDir = resolve(root, 'src');
const entryNames = (await readdir(srcDir))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => file.slice(0, -3));
const entryPoints = Object.fromEntries(
  entryNames.map((name) => [name, resolve(srcDir, `${name}.ts`)])
);

// Transpile every module separately (no bundling). Keeping real ESM module
// boundaries means each runtime module exists exactly once per realm, so
// caches and config globals are shared across all public entry points.
await build({
  entryPoints,
  outdir: dist,
  bundle: false,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  sourcemap: false,
});

// Node's ESM resolver requires explicit file extensions on relative imports.
for (const name of entryNames) {
  const file = resolve(dist, `${name}.js`);
  const code = await readFile(file, 'utf8');
  const rewritten = code.replace(
    /(from\s+|import\(\s*)(['"])(\.\.?\/[^'"]+?)\2/g,
    (match, keyword, quote, spec) =>
      /\.(?:js|json|css|mjs|cjs)$/.test(spec) ? match : `${keyword}${quote}${spec}.js${quote}`
  );
  if (rewritten !== code) {
    await writeFile(file, rewritten);
  }
}

// Keep React's client boundary intact when importing from the package root.
// These small facades re-export the separately built entries instead of
// inlining them into a server or browser bundle.
// Build-time tools (`pseudo.js`, `typegen.js`) and the catalog analyzer
// (`pick-messages.js`, `check.js`) pull in @fluent/syntax — a full FTL parser.
// They are exposed through their own export paths instead of the app entries so
// the browser bundle never pays for a parser it cannot use.
const sharedExports = `export * from './client.js';\nexport * from './navigation.js';\nexport * from './routing.js';\nexport * from './bundle.js';\nexport * from './utils.js';\nexport * from './catalog.js';\nexport {createDefaultFunctions, unwrapFluentValue} from './functions.js';\n`;
await writeFile(resolve(dist, 'index-browser.js'), sharedExports);
await writeFile(
  resolve(dist, 'index-server.js'),
  `export * from './server.js';\nexport * from './server-provider.js';\nexport * from './pick-messages.js';\nexport * from './check.js';\n${sharedExports}`
);

// `next.config.js` is CommonJS in most apps, and Node's `require()` of an ESM
// module returns the module *namespace*. So the natural
// `const createNextFluentPlugin = require('next-fluent/plugin')` would hand back
// `{ default: fn }` and fail with "is not a function" (and outright throw
// ERR_REQUIRE_ESM before Node 22.12). The plugin therefore also ships a real CJS
// build, the way next-intl does for its own `./plugin`.
//
// Only the plugin's dependency closure is duplicated — the app entries stay
// ESM-only, and the plugin runs in the Node config process, a separate realm
// from the app runtime, so nothing that shares per-realm state is copied.
const cjsEntries = ['plugin'];

/** Local modules reachable from `entry`, so the CJS build stays as small as possible. */
async function localClosure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = await readFile(resolve(srcDir, `${entry}.ts`), 'utf8');
  for (const [, spec] of code.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
    await localClosure(spec.slice(2), seen);
  }
  return seen;
}

const cjsNames = [...(await localClosure(cjsEntries[0])).keys()].sort();
const cjsDir = resolve(dist, 'cjs');
await mkdir(cjsDir, { recursive: true });
await build({
  entryPoints: Object.fromEntries(
    cjsNames.map((name) => [name, resolve(srcDir, `${name}.ts`)])
  ),
  outdir: cjsDir,
  bundle: false,
  format: 'cjs',
  platform: 'node',
  target: ['es2022'],
  outExtension: { '.js': '.cjs' },
  sourcemap: false,
  // Handled explicitly by IMPORT_META_STUB below, so the informational warning
  // would only be noise on every build.
  logOverride: { 'empty-import-meta': 'silent' },
});

// `src/plugin.ts` builds a `require` from `import.meta.url`. CJS has no
// `import.meta`, and esbuild's `define` only accepts literals, so left alone it
// emits `const import_meta = {}` and the plugin throws on
// `createRequire(undefined)` at load time. Point the stub at the emitting file's
// own URL, which is exactly what `import.meta.url` means in ESM.
const IMPORT_META_STUB = /^const import_meta = \{\};$/m;
const IMPORT_META_SHIM =
  "const import_meta = { url: require('node:url').pathToFileURL(__filename).href };";

for (const name of cjsNames) {
  const file = resolve(cjsDir, `${name}.cjs`);
  let code = await readFile(file, 'utf8');
  if (/import_meta/.test(code)) {
    const patched = code.replace(IMPORT_META_STUB, IMPORT_META_SHIM);
    // Fail loudly rather than ship a `{}` stub if esbuild ever changes shape.
    if (patched === code) {
      throw new Error(
        `[next-fluent] ${name}.cjs uses import.meta in an unrecognized shape; update IMPORT_META_STUB in scripts/build.mjs`
      );
    }
    code = patched;
  }
  const rewritten = code.replace(
    /(require\(\s*)(['"])(\.\.?\/[^'"]+?)\2/g,
    (match, keyword, quote, spec) =>
      /\.(?:c?js|json)$/.test(spec) ? match : `${keyword}${quote}${spec}.cjs${quote}`
  );
  await writeFile(file, rewritten);
}

// Make the CJS module itself the factory, matching `export =` semantics, while
// keeping `.default` and the named export for interop callers.
const pluginCjs = resolve(cjsDir, 'plugin.cjs');
await writeFile(
  pluginCjs,
  `${await readFile(pluginCjs, 'utf8')}
// A CommonJS \`next.config.js\` calls \`require('next-fluent/plugin')(config)\`, so
// the module has to *be* the factory rather than a namespace holding it. Read
// through \`module.exports\`: esbuild already reassigned it, and the \`exports\`
// binding still points at the original empty object.
module.exports = Object.assign(module.exports.default, module.exports);
`
);

const tscBin = resolve(root, 'node_modules/typescript/bin/tsc');
execSync(
  `"${process.execPath}" "${tscBin}" --declaration --emitDeclarationOnly --noEmit false --outDir dist --rootDir src`,
  {
    cwd: root,
    stdio: 'inherit',
  }
);

console.log('[next-fluent] Build completed successfully.');
