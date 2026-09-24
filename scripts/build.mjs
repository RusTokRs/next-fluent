import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Common externals
const commonExternals = [
  'node:path',
  'node:fs',
  'node:fs/promises',
  'node:url',
  'node:child_process',
  'node:module',
  'path',
  'fs',
  '@fluent/bundle',
  '@fluent/syntax',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'next',
  'next/headers',
  'next/server',
  'next/navigation',
  'next/navigation.js',
  'next/link',
  'next/link.js',
];

// 1. Build general entry points
await build({
  entryPoints: {
    index: resolve(root, 'src/index.ts'),
    server: resolve(root, 'src/server.ts'),
    middleware: resolve(root, 'src/middleware.ts'),
    routing: resolve(root, 'src/routing.ts'),
    plugin: resolve(root, 'src/plugin.ts'),
    factory: resolve(root, 'src/factory.ts'),
    typegen: resolve(root, 'src/typegen.ts'),
    utils: resolve(root, 'src/utils.ts'),
    formatter: resolve(root, 'src/formatter.ts'),
    bundle: resolve(root, 'src/bundle.ts'),
    functions: resolve(root, 'src/functions.ts'),
    pseudo: resolve(root, 'src/pseudo.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  external: commonExternals,
  sourcemap: false,
});

// Keep React's client boundary intact when importing from the package root.
// These small facades re-export the separately built client entry instead of
// inlining it into a server or browser bundle.
const sharedExports = `export * from './client.js';
export * from './navigation.js';
export * from './routing.js';
export * from './bundle.js';
export * from './pseudo.js';
export * from './typegen.js';
export * from './utils.js';
export {createDefaultFunctions, unwrapFluentValue} from './functions.js';
`;
await writeFile(resolve(dist, 'index-browser.js'), sharedExports);
await writeFile(resolve(dist, 'index-server.js'), `export * from './server.js';\nexport * from './server-provider.js';\n${sharedExports}`);

// 2. Build client entry points with guaranteed 'use client' directive banner
await build({
  entryPoints: {
    client: resolve(root, 'src/client.ts'),
    navigation: resolve(root, 'src/navigation.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  banner: {
    js: '"use client";',
  },
  external: commonExternals,
  sourcemap: false,
});

await build({
  entryPoints: { 'server-provider': resolve(root, 'src/server-provider.ts') },
  outdir: dist,
  bundle: false,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
});

const tscBin = resolve(root, 'node_modules/typescript/bin/tsc');
execSync(`"${process.execPath}" "${tscBin}" --declaration --emitDeclarationOnly --noEmit false --outDir dist --rootDir src`, {
  cwd: root,
  stdio: 'inherit',
});

console.log('[next-fluent] Build completed successfully.');
