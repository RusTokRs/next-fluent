/**
 * Audit pass 22 — see ENGINEERING_AUDIT_V22.md.
 *
 * This pass read the four modules that every previous report had skimmed, put
 * two more builder/parser pairs through differential fuzz, and checked one
 * suspected defect that turned out not to exist. What it did find is a public
 * class with a method no test had ever called.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LRUCache } from '../dist/lru.js';
import { buildAlternateLinksHeader } from '../dist/alternate-links.js';
import { localizePath } from '../dist/route-engine.js';
import {
  localeNeedsPrefix,
  normalizeLocalePrefix,
  prefixForLocale,
} from '../dist/locale-prefix.js';
import { parseFtl, junkEntries } from '../dist/ftl-parse.js';
import { createFluentBundle, createTranslator } from '../dist/bundle.js';

// ---------------------------------------------------------------------------
// V22-01: LRUCache is public API, and `delete()` had never been called
// ---------------------------------------------------------------------------

test('V22-01: delete removes an entry and reports whether it was there', () => {
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);

  assert.equal(cache.delete('a'), true, 'deleting a present key reports true');
  assert.equal(cache.delete('a'), false, 'deleting it again reports false');
  assert.equal(cache.has('a'), false);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('b'), 2, 'the other entry is untouched');
});

test('V22-01: deleting frees room, so the next insert does not evict', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.delete('a');
  cache.set('c', 3);

  // Without the delete, inserting `c` would have evicted the LRU entry.
  assert.equal(cache.size, 2);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('V22-01: eviction takes the least recently used entry, and get() refreshes', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1, 'reading `a` makes `b` the LRU entry');
  cache.set('c', 3);

  assert.equal(cache.has('b'), false, '`b` was least recently used and is gone');
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('V22-01: overwriting an existing key never evicts', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);

  assert.equal(cache.size, 2, 'an update is not an insert');
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('b'), 2);
});

test('V22-01: a stored undefined is a hit, not a miss', () => {
  const cache = new LRUCache(2);
  cache.set('a', undefined);

  assert.equal(cache.has('a'), true);
  assert.equal(cache.get('a'), undefined);
  // Presence, not the value, decides: `a` was just read, so `b` is the LRU one.
  cache.set('b', 1);
  cache.set('c', 2);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.get('c'), 2);
});

test('V22-01: clear empties the cache and the constructor rejects bad sizes', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get('a'), undefined);

  for (const bad of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => new LRUCache(bad), /positive integer/, `size ${bad} must be rejected`);
  }
});

// ---------------------------------------------------------------------------
// V22-02: the hreflang alternates against the URLs the library itself builds
// ---------------------------------------------------------------------------

const ALTERNATE_CASES = [
  { name: 'prefix always', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '', pathname: '/about' },
  { name: 'prefix as-needed', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'as-needed',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '', pathname: '/about' },
  { name: 'prefix never', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'never',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '', pathname: '/about' },
  { name: 'basePath', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '/app', pathname: '/about' },
  { name: 'dynamic route', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/news/[slug]': { en: '/news/[slug]', ru: '/novosti/[slug]' } }, basePath: '', pathname: '/news/7' },
  { name: 'three locales', locales: ['en', 'ru', 'de'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas', de: '/ueber-uns' } }, basePath: '', pathname: '/about' },
  { name: 'no pathnames map', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: undefined, basePath: '', pathname: '/about' },
  { name: 'custom prefix', locales: ['en', 'ru'], defaultLocale: 'en',
    localePrefix: { mode: 'always', prefixes: { ru: '/rus' } },
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '', pathname: '/about' },
  { name: 'root path', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/': { en: '/', ru: '/' } }, basePath: '', pathname: '/' },
  { name: 'with search', locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always',
    pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }, basePath: '', pathname: '/about', search: '?ref=x' },
];

const ORIGIN = 'https://example.com';

test('V22-02: every advertised alternate is the URL the library generates for that locale', () => {
  let compared = 0;
  const problems = [];

  for (const c of ALTERNATE_CASES) {
    const header = buildAlternateLinksHeader({
      locales: c.locales, defaultLocale: c.defaultLocale, localePrefix: c.localePrefix,
      pathname: c.pathname, pathnames: c.pathnames, basePath: c.basePath,
      search: c.search ?? '', origin: ORIGIN,
    });

    const prefixConfig = normalizeLocalePrefix(c.locales, c.localePrefix);
    const expected = new Map();
    for (const locale of c.locales) {
      const localized = localizePath(c.pathname, c.defaultLocale, locale, c.pathnames, undefined, c.locales).pathname;
      const prefixed = localeNeedsPrefix(locale, c.defaultLocale, prefixConfig.mode)
        ? (localized === '/' ? prefixForLocale(locale, prefixConfig) : `${prefixForLocale(locale, prefixConfig)}${localized}`)
        : localized;
      const withBase = `${c.basePath}${prefixed === '/' && c.basePath ? '' : prefixed}`;
      expected.set(locale, `${ORIGIN}${withBase}${c.search ?? ''}`);
    }

    if (header === undefined) {
      // Legitimate when every locale resolves to one URL — nothing to advertise.
      if (new Set(expected.values()).size > 1) {
        problems.push({ case: c.name, issue: 'no header, but the locales differ' });
      }
      continue;
    }

    const advertised = new Map();
    for (const part of header.split(/,(?=\s*<)/)) {
      const href = /^<([^>]*)>/.exec(part.trim())?.[1];
      const hreflang = /hreflang="([^"]*)"/.exec(part)?.[1];
      if (href && hreflang) advertised.set(hreflang, href);
    }

    for (const [locale, want] of expected) {
      const got = advertised.get(locale);
      if (got === undefined) continue;
      compared++;
      if (got !== want) problems.push({ case: c.name, locale, advertised: got, library: want });
    }
  }

  assert.ok(compared >= 20, `expected a real sweep, compared ${compared}`);
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// V22-03: what the tooling parses against what the runtime builds
// ---------------------------------------------------------------------------

const CATALOGS = [
  ['plain', 'a = A\nb = B\n'],
  ['duplicate id', 'a = A\na = B\n'],
  ['placeable', 'a = A { $x }\n'],
  ['junk: unterminated', 'broken = { \n'],
  ['junk: no id', '= no id here\n'],
  ['attribute only', 'a =\n    .attr = X\n'],
  ['attribute with value', 'a = A\n    .attr = X\n'],
  ['comment only', '# just a comment\n'],
  ['comment then message', '# c\na = A\n'],
  ['term', '-brand = N\na = { -brand }\n'],
  ['crlf', 'a = A\r\nb = B\r\n'],
  ['bom', '\uFEFFa = A\nb = B\n'],
  ['select', 'a = { $x ->\n   [one] one\n  *[other] other\n}\n'],
  ['trailing blank lines', 'a = A\n\n\n'],
  ['uppercase id', 'A = upper\n'],
  ['bad placeable', 'a = A { 1 + }\n'],
  ['id with dash', 'a-b = AB\n'],
  ['id with underscore', 'a_b = AB\n'],
  ['id with digits', 'a1 = A1\n'],
  ['empty file', ''],
  ['multiline', 'a =\n    line one\n    line two\n'],
  ['mixed junk and good', 'a = A\nbroken = {\nb = B\n'],
];

test('V22-03: the tooling and the runtime agree on the message set', () => {
  let both = 0;
  let junkSeen = 0;
  const problems = [];

  for (const [name, source] of CATALOGS) {
    const resource = parseFtl(source, `catalog "${name}"`);
    const junk = junkEntries(resource);
    if (junk.length > 0) junkSeen++;
    const bundle = createFluentBundle('en', source, { useIsolating: false });
    const tooling = resource.body.filter((e) => e.type === 'Message').map((e) => e.id.name);
    const declared = [...source.matchAll(/^([A-Za-z][A-Za-z0-9_-]*)\s*=/gm)].map((m) => m[1]);

    for (const id of new Set([...declared, ...tooling])) {
      const inTooling = tooling.includes(id);
      const inRuntime = bundle.hasMessage(id);
      if (inTooling && inRuntime) both++;
      if (inTooling !== inRuntime) {
        problems.push({ name, id, inTooling, inRuntime });
      }
      if (!inTooling && !inRuntime && junk.length === 0) {
        problems.push({ name, id, issue: 'dropped everywhere with no junk reported' });
      }
    }
  }

  assert.ok(both >= 20, `expected real comparisons, got ${both}`);
  assert.ok(junkSeen >= 3, `expected the fixtures to contain unparsable text, saw ${junkSeen}`);
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// V22-04: the formatting error keeps its cause — pinned, not fixed
// ---------------------------------------------------------------------------

test('V22-04: a formatting failure reports why, not just that', () => {
  const bundle = createFluentBundle('en', 'price = Total: { BRL($n) }\n', { useIsolating: false });
  const seen = [];
  const t = createTranslator(bundle, { onError: (error) => seen.push(error) });

  assert.equal(t('price', { n: 1 }), 'price', 'an unformattable message renders its own key');
  assert.equal(seen.length, 1);

  const error = seen[0];
  assert.match(error.message, /Could not format message "price"/);
  // `cause` is the list of errors the bundle produced, not a single Error — so
  // it has no `.name`. Reading it as one silently hides the reason, which is
  // exactly what this test exists to prevent.
  assert.ok(Array.isArray(error.cause), 'the underlying errors are attached as a list');
  const reasons = error.cause.map((entry) => entry?.message ?? '');
  assert.ok(
    reasons.some((message) => /Unknown function: BRL\(\)/.test(message)),
    `the missing function must be named, got: ${JSON.stringify(reasons)}`
  );
});
