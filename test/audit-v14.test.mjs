/**
 * Audit pass 14 — see ENGINEERING_AUDIT_V14.md.
 *
 * The URL layer is the one place where a mistake does not fail a test: it fails
 * as a 404, or as a link that goes to the wrong language, in an application
 * somebody is using. `route-engine.ts`, `nav-url.ts`, `alternate-links.ts` and
 * `locale-prefix.ts` build every href the library emits.
 *
 * All of it was probed by hand first and all of it was correct. What was
 * missing is any test on the branches that only run for catch-all routes,
 * percent signs that are not escapes, query strings passed as strings, and the
 * configuration errors a developer is meant to read once.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { renderTemplate, localizePath, validatePathnames, validateRouteEnvironment } from '../dist/route-engine.js';
import { createNavigation } from '../dist/navigation.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Route templates
// ---------------------------------------------------------------------------

test('an optional catch-all collapses when it has no value', () => {
  // Next's own spelling is `[[...slug]]`; `[...slug]` is required.
  assert.equal(renderTemplate('/docs/[[...slug]]', {}), '/docs');
  assert.equal(renderTemplate('/docs/[[...slug]]', { slug: [] }), '/docs');
  assert.equal(renderTemplate('/docs/[[...slug]]', { slug: ['a'] }), '/docs/a');
  assert.equal(renderTemplate('/docs/[[...slug]]', { slug: ['a', 'b'] }), '/docs/a/b');
});

test('a required parameter that is missing is named in the error', () => {
  assert.throws(() => renderTemplate('/x/[id]', {}), /Missing route parameter: id/);
  assert.throws(() => renderTemplate('/docs/[...slug]', {}), /Missing route parameter: slug/);
});

test('a single parameter given an array is refused by name', () => {
  assert.throws(
    () => renderTemplate('/x/[id]', { id: ['a', 'b'] }),
    /Expected one route parameter: id/
  );
});

test('a catch-all in the middle keeps the segments around it', () => {
  assert.equal(renderTemplate('/a/[...rest]/b', { rest: ['x'] }), '/a/x/b');
  assert.equal(renderTemplate('/a/[...rest]/b', { rest: ['x', 'y'] }), '/a/x/y/b');
});

test('a percent sign that is not an escape survives a round trip', () => {
  // `/sale/50%` is a URL people really type. Decoding it throws, so the segment
  // has to be taken as-is and re-encoded — otherwise the link the user clicks
  // and the route the server matches disagree.
  const pathnames = { '/sale/[code]': '/sale/[code]' };
  assert.equal(renderTemplate('/sale/[code]', { code: '50%' }), '/sale/50%25');
  const localized = localizePath('/sale/50%', 'en', 'ru', pathnames);
  assert.equal(localized.pathname, '/sale/50%25');
  assert.deepEqual(localized.consumed, ['code', 'code']);
});

test('valid percent-encoding is decoded before matching and re-encoded after', () => {
  assert.equal(renderTemplate('/x/[name]', { name: 'café' }), '/x/caf%C3%A9');
  const localized = localizePath('/x/caf%C3%A9', 'en', 'ru', { '/x/[name]': '/x/[name]' });
  assert.equal(localized.pathname, '/x/caf%C3%A9');
});

test('an optional catch-all matches both its full and its bare URL', () => {
  const pathnames = { '/docs/[[...slug]]': '/docs/[[...slug]]' };
  assert.deepEqual(localizePath('/docs/a/b', 'en', 'ru', pathnames), {
    pathname: '/docs/a/b',
    consumed: ['slug', 'slug'],
  });
  assert.deepEqual(localizePath('/docs', 'en', 'ru', pathnames), {
    pathname: '/docs',
    consumed: ['slug', 'slug'],
  });
});

// ---------------------------------------------------------------------------
// Configuration errors
// ---------------------------------------------------------------------------
// These are read by a developer at build time. What they must never do is pass
// silently and produce a wrong URL later.

test('a pathname table that is not internal absolute is refused', () => {
  for (const pathnames of [{ a: '/a' }, { '/a': 'b' }, { '/a': '//evil.com/a' }]) {
    assert.throws(
      () => validatePathnames(['en'], pathnames),
      /Pathnames must be internal absolute paths/,
      JSON.stringify(pathnames)
    );
  }
});

test('two internals that render the same external path are refused per locale', () => {
  assert.throws(
    () => validatePathnames(['en'], { '/a': '/b', '/c': '/b' }),
    /Duplicate pathname for en: \/b/
  );
  // The comparison is case-insensitive, because the filesystem may be.
  assert.throws(
    () => validatePathnames(['en'], { '/a': '/B', '/c': '/b' }),
    /Duplicate pathname for en: \/b/
  );
});

test('a renamed parameter in a localized path is refused', () => {
  assert.throws(
    () => validatePathnames(['en'], { '/[id]': '/[slug]' }),
    /Route parameters differ for \/\[id\] \(en\)/
  );
});

test('basePath is refused for every shape that would build a wrong URL', () => {
  for (const basePath of ['/app/', 'app', '/app?x=1', '/app#x', '//app']) {
    assert.throws(
      () => validateRouteEnvironment(['en'], [], basePath),
      /basePath must be an absolute path without a trailing slash/,
      basePath
    );
  }
  // An absent or empty basePath is a normal configuration.
  assert.doesNotThrow(() => validateRouteEnvironment(['en'], [], ''));
  assert.doesNotThrow(() => validateRouteEnvironment(['en'], [], undefined));
});

// ---------------------------------------------------------------------------
// Hrefs as applications actually pass them
// ---------------------------------------------------------------------------

const nav = createNavigation({
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

test('a pathname without a leading slash is still a path', () => {
  assert.equal(nav.getPathname({ href: { pathname: 'about' } }), '/about');
  assert.equal(nav.getPathname({ href: { pathname: '/about' } }), '/about');
});

test('a query given as a string is carried through either way', () => {
  assert.equal(nav.getPathname({ href: { pathname: '/about', query: '?a=1&b=2' } }), '/about?a=1&b=2');
  assert.equal(nav.getPathname({ href: { pathname: '/about', query: 'a=1' } }), '/about?a=1');
  assert.equal(nav.getPathname({ href: { pathname: '/about', query: 'a=1&a=2' } }), '/about?a=1&a=2');
});

test('a query given as an object drops empty values and expands arrays', () => {
  assert.equal(
    nav.getPathname({
      href: { pathname: '/about', query: { a: 1, b: null, c: undefined, d: [1, 2] } },
    }),
    '/about?a=1&d=1&d=2',
    'a null or undefined value would otherwise become the literal text "null"'
  );
});

// ---------------------------------------------------------------------------
// Where `LocalizedLink` is covered
// ---------------------------------------------------------------------------
// It has no Node test and cannot have one: it renders Next's `Link`, which needs
// the App Router context. It is not uncovered, though — the fixture renders one
// and the browser gate clicks it. That arrangement is easy to break by accident
// (delete the fixture link, and nothing here notices), so it is asserted.

test('LocalizedLink is covered by the browser gate, not by a Node test', async () => {
  const fixture = await fs.promises.readFile(
    path.join(root, 'test/fixtures/next-app/app/[locale]/client.tsx'),
    'utf8'
  );
  assert.match(fixture, /'use client'/, 'the link has to hydrate to be clickable');
  assert.match(fixture, /<Link\b/, 'the fixture must render a localized link');
  assert.match(fixture, /locale="/, 'and one with an explicit locale, which is the redirecting case');

  const harness = await fs.promises.readFile(
    path.join(root, 'scripts/test-next-integration.mjs'),
    'utf8'
  );
  assert.match(
    harness,
    /link "Switch to English"/,
    'the browser gate has to find and click that link'
  );
  assert.match(harness, /run\('click', link\[1\]\)/, 'clicking it is what makes the check a test');
  assert.match(
    harness,
    /\/about-us/,
    'and the outcome asserted is the switched URL, not just that something happened'
  );
});
// ---------------------------------------------------------------------------
// The webpack half of the Next plugin
// ---------------------------------------------------------------------------
// The Turbopack alias was covered from V2 on. The `webpack` function — the whole
// of which sat uncovered — is what makes `next-fluent/config` resolvable in a
// webpack build; if it breaks, the server cannot load the request config and the
// app fails at runtime rather than at build time.

test('the plugin wires the webpack alias and chains a user function', async () => {
  const { createNextFluentPlugin } = await import('../dist/plugin.js');
  const plugin = createNextFluentPlugin('./src/i18n/request.ts');

  const config = plugin({});
  const webpacked = config.webpack({}, {});
  const alias = webpacked.resolve.alias['next-fluent/config'];
  assert.ok(path.isAbsolute(alias), `webpack needs an absolute alias, got ${alias}`);
  assert.equal(alias, path.resolve(process.cwd(), './src/i18n/request.ts'));

  // A user-provided webpack function still runs, and sees the alias.
  const chained = plugin({
    webpack: (received) => ({ ...received, fromUser: true }),
  }).webpack({ resolve: {} }, {});
  assert.equal(chained.fromUser, true);
  assert.ok(chained.resolve.alias['next-fluent/config']);
});

test('the plugin adds an alias to a config that has none, and keeps existing ones', async () => {
  const { createNextFluentPlugin } = await import('../dist/plugin.js');
  const plugin = createNextFluentPlugin('./src/i18n/request.ts');

  assert.deepEqual(plugin({}).webpack({}, {}).resolve.alias, {
    'next-fluent/config': path.resolve(process.cwd(), './src/i18n/request.ts'),
  });
  const kept = plugin({}).webpack({ resolve: { alias: { other: '/x' } } }, {});
  assert.equal(kept.resolve.alias.other, '/x', "the project's own aliases must survive");
  assert.ok(kept.resolve.alias['next-fluent/config']);
});

// ---------------------------------------------------------------------------
// Type generation across several catalogs
// ---------------------------------------------------------------------------
// The catalog is the source of truth for the typed API, so a merge mistake here
// turns into a type error in every file of the application.

test('a key redefined by a later catalog takes the later definition', async () => {
  const { generateTypeDeclarations } = await import('../dist/typegen.js');
  const declarations = generateTypeDeclarations(['a = { $first }\n', 'a = { $second }\n']);
  assert.match(declarations, /'a': \{ 'second': string \| number \| Date \}/);
  assert.doesNotMatch(declarations, /'first'/, 'the shadowed definition must not leak into the types');
});

test('a later definition replaces the earlier one, exactly as the runtime does', async () => {
  const { generateTypeDeclarations } = await import('../dist/typegen.js');
  // `en.ftl` and `en-nav.ftl` both defining `nav` is the normal namespaced
  // setup, and Fluent replaces the whole message — so the attributes of the
  // shadowed definition are gone, not merged. The runtime agrees; see the
  // cross-check below.
  const declarations = generateTypeDeclarations([
    'nav =\n    .title = Home\n',
    'nav =\n    .label = Label\n',
  ]);
  assert.match(declarations, /'nav\.label'/);
  assert.doesNotMatch(declarations, /'nav\.title'/, 'the shadowed attribute must not stay addressable');
});

test('what typegen declares is what the runtime resolves', async () => {
  // The promise the typed API makes is that `t('unknown')` does not compile.
  // It can only be kept if the declarations and the bundle agree, so this
  // compares them instead of asserting a shape.
  const { generateTypeDeclarations } = await import('../dist/typegen.js');
  const { createFluentBundle, createTranslator } = await import('../dist/bundle.js');

  const catalogs = [
    'shared =\n    .title = Home\n',
    'shared =\n    .label = Label\n',
    'plain = Just text\n    .hint = Because\n',
    'shadowed =\n    .gone = Old\n',
    'shadowed =\n    .here = New\n',
  ];
  const declared = new Set(
    [...generateTypeDeclarations(catalogs).matchAll(/'([^']+)'\??:/g)].map((match) => match[1])
  );

  const errors = [];
  const t = createTranslator(createFluentBundle('en', catalogs), {
    onError: (error) => errors.push(error.key),
  });

  for (const key of declared) {
    errors.length = 0;
    t(key);
    assert.equal(errors.length, 0, `"${key}" is declared but the runtime cannot resolve it`);
  }
  // And the reverse: a key the runtime can resolve is reachable by name.
  assert.ok(declared.has('shared.label'), 'the surviving attribute is declared');
  assert.equal(declared.has('shared.title'), false, 'the shadowed one is not');
});

test('generation is stable when nothing changed', async () => {
  const { generateTypeDeclarations } = await import('../dist/typegen.js');
  const catalog = 'a = A\nb = B\n';
  assert.equal(generateTypeDeclarations([catalog]), generateTypeDeclarations([catalog]));
  // And the order of the input does not decide the order of the output.
  assert.equal(
    generateTypeDeclarations(['a = A\nb = B\n']),
    generateTypeDeclarations(['b = B\na = A\n'])
  );
});
