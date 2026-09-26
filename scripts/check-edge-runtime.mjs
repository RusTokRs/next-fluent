/**
 * Edge runtime guarantee.
 *
 * `middleware.ts` runs in the edge runtime, where `node:*` built-ins, `require`,
 * `__dirname` and React's server-only entry points do not exist. Unit tests run
 * in Node, so they would never notice; this script bundles the middleware graph
 * the way an edge bundler would, rejects Node-only references, and then actually
 * executes it against a Web-standard `Request`.
 */
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);

const result = await build({
  entryPoints: [path.join(root, 'src/middleware.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  // Next provides these at runtime; the middleware imports `next/server.js`
  // with an extension, so both spellings must stay external.
  external: ['next', 'next/*', 'next/server', 'next/server.js', 'next/headers', 'next/headers.js'],
});

const code = result.outputFiles[0].text;
const failures = [];

const nodeImports = [...code.matchAll(/(?:from|import)\s*\(?['"](node:[^'"]+)['"]/g)].map(
  (match) => match[1]
);
if (nodeImports.length > 0) {
  failures.push(`middleware bundle imports Node built-ins: ${[...new Set(nodeImports)].join(', ')}`);
}

if (/\brequire\s*\(/.test(code)) {
  failures.push('middleware bundle contains a CommonJS require() call');
}
if (/\b__dirname\b|\b__filename\b/.test(code)) {
  failures.push('middleware bundle references __dirname/__filename');
}
if (/['"]next\/headers(\.js)?['"]/.test(code)) {
  failures.push('middleware bundle imports next/headers (server-only)');
}
if (/(?:from|import)\s*\(?['"]react['"]/.test(code)) {
  failures.push('middleware bundle pulls React into the edge graph');
}

// Execute the bundle: an import that only type-checks tells us nothing. It is
// written inside the repo so Node resolves the external `next/server` import.
const dir = await mkdtemp(path.join(root, '.tmp-edge-'));
const file = path.join(dir, 'middleware.mjs');
await writeFile(file, code, 'utf8');

try {
  const { createI18nMiddleware } = await import(pathToFileURL(file).href);
  const middleware = createI18nMiddleware({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  });

  // A real Web `Request`, extended only with the two fields Next adds.
  const request = new Request('http://localhost:3000/ru/about', {
    headers: { 'accept-language': 'ru-RU,ru;q=0.9', 'sec-fetch-dest': 'document' },
  });
  const nextRequest = Object.assign(request, {
    nextUrl: { pathname: '/ru/about', search: '' },
    cookies: { get: () => undefined },
  });

  const response = await middleware(nextRequest);
  const rewrite = response.headers.get('x-middleware-rewrite');
  const locale = response.headers.get('x-next-locale');
  if (locale !== 'ru') failures.push(`expected locale "ru", got "${locale}"`);
  // `/ru/about` is already canonical: rewriting it again would loop.
  if (rewrite !== null) failures.push(`expected no rewrite for a canonical URL, got "${rewrite}"`);

  // An unprefixed URL with a Russian preference must redirect to /ru/about.
  const bare = new Request('http://localhost:3000/about', {
    headers: { 'accept-language': 'ru-RU,ru;q=0.9', 'sec-fetch-dest': 'document' },
  });
  const bareResponse = await middleware(
    Object.assign(bare, {
      nextUrl: { pathname: '/about', search: '' },
      cookies: { get: () => undefined },
    })
  );
  const location = bareResponse.headers.get('location');
  if (!location || !location.endsWith('/ru/about')) {
    failures.push(`expected a redirect to /ru/about, got "${location}"`);
  }
  console.log(`[next-fluent] edge smoke: locale=${locale} canonical-rewrite=${rewrite} redirect=${location}`);
} catch (error) {
  failures.push(`middleware failed to execute: ${error.message}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const kb = (code.length / 1024).toFixed(1);
console.log(`[next-fluent] middleware bundle: ${kb} kB (edge target)`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('[next-fluent] Edge runtime check passed.');
