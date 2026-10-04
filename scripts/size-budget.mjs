/**
 * Client bundle size budget.
 *
 * The client entry ships to every browser that renders a localized page, so its
 * size is a product constraint rather than an implementation detail. This script
 * bundles the public client entries the way an app bundler would (React and Next
 * external, minified) and fails when a budget is exceeded.
 *
 * Run with `npm run size`; wired into `npm run ci`.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Budgets in bytes. */
const BUDGETS = [
  {
    name: 'next-fluent (root, client)',
    entry: path.join(root, 'src/index-browser.ts'),
    maxMinified: 48 * 1024,
    // +128 B gzip for effective-prefix validation and segment-wise route priority.
    // A further +128 B permits deeply copied/frozen routing definitions.
    // Audit V4-12/V4-13 raise both by ~0.3 kB: honoring an absolute URL object
    // costs ~0.28 kB gzip, a stable table for custom Fluent functions ~0.14 kB.
    maxGzip: 16.5 * 1024,
  },
  {
    name: 'next-fluent/client',
    entry: path.join(root, 'src/client.ts'),
    // Absolute domain locale switches must carry a cookie-update signal too.
    // +128 B allowance for the browser-verified fix (measured gzip ~13.04 kB).
    maxMinified: 39.5 * 1024,
    maxGzip: 13.75 * 1024,
  },
  {
    // The library's own code, without the Fluent runtime it depends on.
    // Per-domain localePrefix adds shared domain resolution to navigation,
    // Link and locale switching. Budgets raised 35 -> 35.5 kB minified and
    // 11.75 -> 12 kB gzip for that deliberate feature cost. Including the
    // browser-verified switch fixes, measured size is ~35.5/11.9 kB.
    // Effective-prefix validation and route priority need a further +256 B
    // minified allowance (measured ~35.7 kB); gzip stays within 12 kB.
    name: 'next-fluent own code (bundle external)',
    entry: path.join(root, 'src/index-browser.ts'),
    extraExternal: ['@fluent/bundle'],
    // Deep routing snapshots add ~0.2 kB minified / ~0.1 kB gzip.
    // The previous budget left 45 B of gzip headroom, so audit V4-12/V4-13
    // (~0.42 kB gzip minified, ~0.9 kB minified) needed the next step up.
    maxMinified: 37.5 * 1024,
    maxGzip: 13 * 1024,
  },
  {
    name: '@fluent/bundle (runtime dependency)',
    entry: path.join(root, 'node_modules/@fluent/bundle/esm/index.js'),
    maxMinified: 12.5 * 1024,
    maxGzip: 4.5 * 1024,
  },
];

const failures = [];
const rows = [];

for (const budget of BUDGETS) {
  const result = await build({
    entryPoints: [budget.entry],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    external: [
      'react',
      'react/jsx-runtime',
      'next',
      'next/link',
      'next/link.js',
      'next/navigation',
      'next/router',
      ...(budget.extraExternal ?? []),
    ],
  });

  const code = result.outputFiles[0].text;
  const minified = Buffer.byteLength(code, 'utf8');
  const gzip = gzipSync(code).length;

  rows.push({
    name: budget.name,
    minified,
    gzip,
    minBudget: budget.maxMinified,
    gzipBudget: budget.maxGzip,
  });

  if (minified > budget.maxMinified) {
    failures.push(
      `${budget.name}: minified ${minified} B exceeds the ${budget.maxMinified} B budget`
    );
  }
  if (gzip > budget.maxGzip) {
    failures.push(`${budget.name}: gzip ${gzip} B exceeds the ${budget.maxGzip} B budget`);
  }
}

const fmt = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const width = Math.max(...rows.map((row) => row.name.length));
console.log(`${'entry'.padEnd(width)}  minified      gzip`);
for (const row of rows) {
  console.log(
    `${row.name.padEnd(width)}  ${fmt(row.minified).padStart(9)} / ${fmt(row.minBudget).padStart(9)}  ` +
      `${fmt(row.gzip).padStart(8)} / ${fmt(row.gzipBudget).padStart(8)}`
  );
}

if (failures.length > 0) {
  console.error('\n[next-fluent] Size budget exceeded:');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\n[next-fluent] Size budgets respected.');
