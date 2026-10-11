/**
 * Client bundle size budget.
 *
 * The client entry ships to every browser that renders a localized page, so its
 * size is a product constraint rather than an implementation detail. This script
 * bundles the client surface an app imports — `test/fixtures/size/client-consumer.ts`,
 * resolved through the published `exports` map — the way an app bundler would
 * (React and Next external, minified, `NODE_ENV=production`), and fails when a
 * budget is exceeded.
 *
 * Why the fixture and not the package root: the root re-exports every module for
 * convenience, so bundling it as an entry point keeps `utils`, `catalog` and
 * `functions` in full even though an app that never calls them tree-shakes them
 * away. On the same revision that difference was 48.7 kB vs 47.0 kB minified
 * (16.6 kB vs 15.9 kB gzip) — a budget measured on the root would have watched
 * ~1.7 kB no visitor downloads. The fixture imports the whole documented client
 * API, so anything an app can actually reach is still measured; see the file's
 * own header for the two rules that keep it honest.
 *
 * `dist/` has to be current: the fixture resolves `next-fluent/...` through the
 * package's own exports map (that is the point), so `npm run size` builds first.
 *
 * Run with `npm run size`; wired into `npm run ci`.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const consumerFixture = path.join(root, 'test/fixtures/size/client-consumer.ts');

/**
 * What a browser bundle is built with. `process.env.NODE_ENV` is set explicitly
 * rather than left to esbuild's implicit browser default so the measurement
 * states its own production assumption — the same one Next.js, webpack and
 * Turbopack make.
 */
const PRODUCTION_DEFINE = { 'process.env.NODE_ENV': '"production"' };

const EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'next',
  'next/link',
  'next/link.js',
  'next/navigation',
  'next/router',
];

/** Budgets in bytes. */
const BUDGETS = [
  {
    name: 'next-fluent client API (app fixture)',
    entry: consumerFixture,
    // Audit V4-12/V4-13 raised this ~0.3 kB gzip: honoring an absolute URL
    // object costs ~0.28 kB gzip, a stable table for custom Fluent functions
    // ~0.14 kB.
    // Audit pass 6 (V6-01, V6-02, V6-06, V6-08) adds correctness to the same
    // graph: a protocol-relative href can no longer escape through backslash
    // normalization, an object href's port is validated, FluentType values from
    // a second @fluent/bundle copy are unwrapped instead of failing, cyclic Intl
    // options no longer overflow the stack.
    // Re-baselined onto the fixture when the root-entry measurement was
    // replaced; measured after that pass: 47.0 kB minified / 15.9 kB gzip.
    maxMinified: 47.5 * 1024,
    maxGzip: 16.25 * 1024,
  },
  {
    // The library's own code, without the Fluent runtime it depends on.
    name: 'next-fluent own code (bundle external)',
    entry: consumerFixture,
    extraExternal: ['@fluent/bundle'],
    // Per-domain localePrefix adds shared domain resolution to navigation, Link
    // and locale switching; effective-prefix validation and segment-wise route
    // priority add a little more. Measured on the fixture: 36.2 kB minified /
    // 12.3 kB gzip.
    maxMinified: 36.75 * 1024,
    maxGzip: 12.75 * 1024,
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
    define: PRODUCTION_DEFINE,
    external: [...EXTERNAL, ...(budget.extraExternal ?? [])],
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

// The browser-path catalog diagnostics (`src/catalog-integrity.ts`) are guarded
// by `process.env.NODE_ENV`, so a production build has to drop them. Measuring
// the same fixture as a development build proves the guard still works: if the
// scan ever moves outside it, both builds collapse to the same size and this
// fails — the alternative is discovering it in a release as a silent kilobyte.
const devResult = await build({
  entryPoints: [consumerFixture],
  bundle: true,
  write: false,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': '"development"' },
  external: EXTERNAL,
});
const devMinified = Buffer.byteLength(devResult.outputFiles[0].text, 'utf8');
const prodMinified = rows[0].minified;
const diagnosticsBytes = devMinified - prodMinified;
if (diagnosticsBytes < 256) {
  failures.push(
    `the development-only catalog diagnostics are not eliminated from the production ` +
      `bundle (production ${prodMinified} B vs development ${devMinified} B)`
  );
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
console.log(
  `\ndevelopment-only diagnostics: ${diagnosticsBytes} B (development ${devMinified} B, ` +
    `production ${prodMinified} B)`
);

if (failures.length > 0) {
  console.error('\n[next-fluent] Size budget exceeded:');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\n[next-fluent] Size budgets respected.');
