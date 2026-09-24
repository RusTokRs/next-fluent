import { mkdir, rm } from 'node:fs/promises';
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
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  external: commonExternals,
  sourcemap: false,
});

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

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execSync(`${npmCmd} exec tsc -- --declaration --emitDeclarationOnly --noEmit false --outDir dist --rootDir src`, {
  cwd: root,
  stdio: 'inherit',
});

console.log('[next-fluent] Build completed successfully.');
