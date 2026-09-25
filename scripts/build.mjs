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
const sharedExports = `export * from './client.js';\nexport * from './navigation.js';\nexport * from './routing.js';\nexport * from './bundle.js';\nexport * from './pseudo.js';\nexport * from './typegen.js';\nexport * from './utils.js';\nexport {createDefaultFunctions, unwrapFluentValue} from './functions.js';\n`;
await writeFile(resolve(dist, 'index-browser.js'), sharedExports);
await writeFile(
  resolve(dist, 'index-server.js'),
  `export * from './server.js';\nexport * from './server-provider.js';\n${sharedExports}`
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
