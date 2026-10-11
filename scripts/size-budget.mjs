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
 * Pass 8 checked the other side of that argument — whether the *browser* entry
 * should stop re-exporting server-only helpers (`resolveAcceptLanguage`,
 * `checkCatalogs`, the pseudo-localizer) instead of paying for a raised budget.
 * A bundle of the fixture contains none of them: an app that does not call them
 * already downloads nothing for them. Narrowing the entry would only break
 * callers who do, so the budget was raised by the measured cost of the pass
 * instead (the numbers are in the two comments below).
 *
 * Pass 9 added the other half of the picture. "The fixture imports the whole
 * documented client API, so anything an app can actually reach is still
 * measured" was true of the documentation and false of the exports: the root
 * browser entry exports 42 names, the fixture imported 17, and an app that used
 * the rest shipped 1.67 kB that no budget watched — more than the fixture's own
 * headroom. So there are two numbers now:
 *
 *   - the **fixture**, what an app that uses the documented client API
 *     downloads (unchanged meaning, unchanged entry file);
 *   - the **ceiling**, every runtime export of every browser-reachable entry,
 *     generated from the package's own exports rather than written by hand, so
 *     it cannot fall behind a new export. esbuild's metafile is compared against
 *     those exports, which makes the ceiling self-verifying rather than a
 *     second hand-kept list.
 *
 * `dist/` has to be current: both entries resolve `next-fluent/...` through the
 * package's own exports map (that is the point), so `npm run size` builds first.
 *
 * Run with `npm run size`; wired into `npm run ci`.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const consumerFixture = path.join(root, 'test/fixtures/size/client-consumer.ts');

/**
 * Public entry points a browser bundle can import: the package root plus the
 * pure-logic subpaths. Everything else is server-, edge- or build-time by
 * design — `catalog-io` and `usage` reach for `node:*`, and `check`,
 * `pick-messages`, `pseudo` and `typegen` pull in `@fluent/syntax`, a full FTL
 * parser, which is why they are published under their own paths instead of the
 * app entries (see `scripts/build.mjs`).
 */
const CLIENT_ENTRIES = [
  'next-fluent',
  'next-fluent/client',
  'next-fluent/navigation',
  'next-fluent/routing',
  'next-fluent/formatter',
  'next-fluent/utils',
  'next-fluent/catalog',
];

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
    entry: 'fixture',
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
    // Raised once, on measurement, by pass 8 (+0.5 kB minified / +0.25 kB
    // gzip): ASCII tab/LF/CR are stripped from a route before the leading
    // separator run is collapsed, so `"/\n/evil.example"` can no longer leave
    // this origin, plus the `dateTime` diagnostics above.
    // Raised again, on measurement, by pass 9 (+0.44 kB minified / +0.12 kB
    // gzip): `number` and `relativeTime` now report the option sets `Intl`
    // refuses instead of rendering a bare value in silence, and a JSON catalog
    // with an empty message object is rejected instead of dropping the message.
    // Measured after that pass: 48.42 kB minified / 16.32 kB gzip; 48.83 kB /
    // 16.53 kB once the FTL-side `Intl` diagnostics landed as well.
    maxMinified: 49.0 * 1024,
    maxGzip: 16.75 * 1024,
  },
  {
    // The library's own code, without the Fluent runtime it depends on.
    name: 'next-fluent own code (bundle external)',
    entry: 'fixture',
    extraExternal: ['@fluent/bundle'],
    // Per-domain localePrefix adds shared domain resolution to navigation, Link
    // and locale switching; effective-prefix validation and segment-wise route
    // priority add a little more.
    // Raised once, on measurement, by pass 8 (+0.55 kB minified / +0.45 kB
    // gzip): `dateTime` no longer blames a valid time zone for an option
    // combination Intl refused, and can still render localized text when the
    // cause is `dateStyle`/`timeStyle` next to a component option. Measured
    // after that pass: 37.13 kB minified / 12.56 kB gzip.
    // Raised again by pass 9 for the same diagnostics: measured after it,
    // 37.55 kB minified / 12.71 kB gzip.
    maxMinified: 38.5 * 1024,
    maxGzip: 13.25 * 1024,
  },
  {
    name: '@fluent/bundle (runtime dependency)',
    entry: path.join(root, 'node_modules/@fluent/bundle/esm/index.js'),
    maxMinified: 12.5 * 1024,
    maxGzip: 4.5 * 1024,
  },
];

// ---------------------------------------------------------------------------
// The ceiling: what the whole browser-reachable surface costs
// ---------------------------------------------------------------------------
// The fixture above measures what an app *usually* downloads, and it can only
// do that because it imports names by hand. The other side of that trade was
// never measured, and the fixture cannot measure it: the root browser entry
// exports 42 names (V9-01), of which the fixture imported 17, so an app that
// legitimately used `jsonToFluent`, `matchSupportedLocale` or `LRUCache`
// shipped 49.6 kB — over the budget this script claims to protect, through code
// no budget could see.
//
// So the ceiling entry is *generated* from the package's own exports rather
// than written by hand, which makes it impossible to fall behind: a new export
// is in it the moment it exists. It lives in a temporary directory inside the
// package so the specifiers resolve through the same `exports` map a consumer
// would use.
const ceilingDir = await mkdtemp(path.join(root, '.size-ceiling-'));
const ceilingEntry = path.join(ceilingDir, 'ceiling.ts');
await writeFile(
  ceilingEntry,
  `${CLIENT_ENTRIES.map((specifier) => `export * from '${specifier}';`).join('\n')}\n`,
  'utf8'
);

BUDGETS.push(
  {
    name: 'client API, every export (ceiling)',
    entry: ceilingEntry,
    // Measured: 49.63 kB minified / 16.88 kB gzip. The gap to the fixture is
    // the 1.67 kB the fixture never imported — code that existed, was reachable
    // and was unbudgeted.
    // Raised once more, on measurement, by the FTL-side `Intl` diagnostics this
    // pass added to `CURRENCY()`/`PERCENT()` (+0.9 kB minified / +0.35 kB gzip
    // over the entry above). Measured after: 50.51 kB / 17.24 kB.
    maxMinified: 51.0 * 1024,
    maxGzip: 17.5 * 1024,
  },
  {
    name: 'own code, every export (ceiling)',
    entry: ceilingEntry,
    extraExternal: ['@fluent/bundle'],
    // Measured after the FTL-side diagnostics: 39.67 kB minified / 13.47 kB gzip.
    maxMinified: 40.0 * 1024,
    maxGzip: 14.0 * 1024,
  }
);

const failures = [];
const rows = [];

for (const budget of BUDGETS) {
  const result = await build({
    entryPoints: [budget.entry === 'fixture' ? consumerFixture : budget.entry],
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

// The ceiling has to *be* the ceiling. esbuild's metafile lists what the
// bundle actually exports, so the names are compared against the real runtime
// exports of the entries rather than against a list kept by hand: a new export
// cannot slip in unmeasured, and a renamed one cannot quietly shrink the
// ceiling while the fixture stays green.
{
  const expected = new Set();
  for (const specifier of CLIENT_ENTRIES) {
    for (const name of Object.keys(await import(specifier))) expected.add(name);
  }
  const probe = await build({
    entryPoints: [ceilingEntry],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    define: PRODUCTION_DEFINE,
    external: EXTERNAL,
    metafile: true,
  });
  const bundled = new Set(Object.values(probe.metafile.outputs).flatMap((out) => out.exports));
  const unmeasured = [...expected].filter((name) => !bundled.has(name));
  if (unmeasured.length > 0) {
    failures.push(
      `the client ceiling does not export ${unmeasured.length} runtime export(s) of ` +
        `${CLIENT_ENTRIES.join(', ')}: ${unmeasured.join(', ')} — they are reachable ` +
        'from a browser but the ceiling bundle does not carry them'
    );
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

await rm(ceilingDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('\n[next-fluent] Size budget exceeded:');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\n[next-fluent] Size budgets respected.');
