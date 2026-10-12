/**
 * Audit pass 21 — see ENGINEERING_AUDIT_V21.md.
 *
 * Two things. First: V20 taught `FluentServerProvider` to report the Fluent
 * functions it cannot serialize, and this pass measured that it drops three more
 * categories without a word. Second: the differential-fuzz technique from V20 is
 * applied to the locale-prefix round trip, where it finds nothing — recorded
 * here so the pair is pinned rather than merely "believed fine".
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as server from '../dist/server.js';
import { FluentServerProvider } from '../dist/server-provider.js';
import { validateLocalePrefix } from '../dist/utils.js';
import {
  normalizeLocalePrefix,
  prefixForLocale,
  matchLocalePrefix,
} from '../dist/locale-prefix.js';
import { defineRouting } from '../dist/routing.js';

const BASELINE = { locales: ['en'], defaultLocale: 'en' };

/** Runs `body` with `NODE_ENV` pinned. Awaited: the provider is async. */
async function withNodeEnv(value, body) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    server.configureServerI18n(BASELINE);
  }
}

/** Captures `console.warn` output for the duration of an async `body`. */
async function captureWarnings(body) {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    return { result: await body(), seen };
  } finally {
    console.warn = original;
  }
}

function configure(partial) {
  server.configureServerI18n(BASELINE);
  server.setRequestConfig(async ({ locale }) => ({ locale, messages: 'hi = Hi { $name }\n', ...partial }));
}

const render = () => FluentServerProvider({ children: null, locale: 'en' });

// ---------------------------------------------------------------------------
// V21-01: the provider dropped four categories and reported one
// ---------------------------------------------------------------------------

test('V21-01: callback rich values, onError and getMessageFallback do not cross', async () => {
  await withNodeEnv('development', async () => {
    configure({
      defaultTranslationValues: { name: 'Ann', rich: (chunks) => `R(${chunks})` },
      onError: () => {},
      getMessageFallback: ({ key }) => `[missing:${key}]`,
    });
    const { result } = await captureWarnings(render);

    // The serializable half of `defaultTranslationValues` crosses; the callback
    // is filtered out. That filter is correct — and it is the silent part.
    assert.deepEqual(Object.keys(result.props.defaultTranslationValues), ['name']);
    assert.equal('onError' in result.props, false);
    assert.equal('getMessageFallback' in result.props, false);
  });
});

test('V21-01: every dropped category is named, not just the Fluent functions', async () => {
  await withNodeEnv('development', async () => {
    configure({
      functions: { BRL: () => 'x', USD: () => 'y' },
      defaultTranslationValues: { name: 'Ann', rich: (chunks) => `R(${chunks})`, link: () => 'L' },
      onError: () => {},
      getMessageFallback: ({ key }) => `[${key}]`,
    });
    const { seen } = await captureWarnings(render);

    assert.equal(seen.length, 1, 'one warning for the whole boundary, not one per category');
    const message = seen[0];
    assert.match(message, /Fluent functions "BRL", "USD"/);
    assert.match(message, /callback defaultTranslationValues "rich", "link"/);
    assert.match(message, /`onError`/);
    assert.match(message, /`getMessageFallback`/);
    assert.match(message, /cannot cross the Server Component boundary/);
    assert.match(message, /'use client'/);
  });
});

test('V21-01: a serializable-only config produces no warning at all', async () => {
  await withNodeEnv('development', async () => {
    configure({
      defaultTranslationValues: { name: 'Ann' },
      timeZone: 'UTC',
      useIsolating: false,
      fallbackLocale: 'en',
    });
    const { result, seen } = await captureWarnings(render);
    assert.deepEqual(seen, [], 'nothing was dropped, so nothing is reported');
    // What does cross still crosses.
    assert.equal(result.props.useIsolating, false);
    assert.equal(result.props.timeZone, 'UTC');
    assert.deepEqual(result.props.defaultTranslationValues, { name: 'Ann' });
  });
});

test('V21-01: production stays silent even with everything dropped', async () => {
  await withNodeEnv('production', async () => {
    configure({
      functions: { BRL: () => 'x' },
      onError: () => {},
      getMessageFallback: ({ key }) => `[${key}]`,
    });
    const { seen } = await captureWarnings(render);
    assert.deepEqual(seen, []);
  });
});

// ---------------------------------------------------------------------------
// V21-02: prefixForLocale <-> matchLocalePrefix round trip
// ---------------------------------------------------------------------------

const LOCALE_SETS = [
  ['en', 'ru'],
  ['en', 'ru', 'ru-RU'],
  ['EN', 'en'],
  ['en-US', 'en'],
  ['de', 'de-AT', 'de-CH'],
  ['en'],
];

const PREFIXES = [
  undefined,
  {},
  { ru: '/ru' },
  { ru: '/russian' },
  { en: '/en', ru: '/ru' },
  { ru: '/en' }, // collides with en's implicit default prefix
  { 'ru-RU': '/ru' },
  { 'en-US': '/us' },
  { ru: '/a/b' },
  { ru: 'ru' }, // not absolute
  { ru: '/ru/' }, // trailing slash
  { ru: '//ru' },
  { ru: '' },
  { ru: '/ru?x' },
  { ru: '/./ru' },
  { ru: '/ru', 'ru-RU': '/ru' }, // two locales, one prefix
  { de: '/de', 'de-AT': '/de-AT', 'de-CH': '/de' },
  { fr: '/fr' }, // unsupported locale key
];

const MODES = [undefined, 'always', 'as-needed', 'never'];

const RESTS = [
  '/about',
  '/',
  '//about',
  '/about/',
  '/a//b',
  '/about-us/deep/path',
  '/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82',
  '/ünïcödé',
  '/a b',
  '/x.y',
  '/UPPER',
];

test('V21-02: every accepted config round-trips locale and path', () => {
  let checked = 0;
  const failures = [];

  for (const locales of LOCALE_SETS) {
    for (const prefixes of PREFIXES) {
      for (const mode of MODES) {
        const localePrefix =
          prefixes === undefined && mode === undefined ? undefined : { mode, ...(prefixes ? { prefixes } : {}) };
        let valid = true;
        try {
          validateLocalePrefix(locales, localePrefix);
        } catch {
          valid = false;
        }
        if (!valid) continue;

        const config = normalizeLocalePrefix(locales, localePrefix);
        for (const locale of locales) {
          const pathname = `${prefixForLocale(locale, config)}`;
          for (const rest of RESTS) {
            const full = `${pathname}${rest === '/' ? '' : rest}`;
            const expected = rest.replace(/^\/+/, '/');
            const match = matchLocalePrefix(full, locales, config);
            checked++;
            if (!match || match.locale !== locale || match.rest !== expected) {
              failures.push({ locales: [...locales], locale, full, match, expected });
            }
          }
        }
      }
    }
  }

  assert.ok(checked > 2000, `expected a thorough sweep, checked ${checked}`);
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of ${checked} round trips failed`);
});

test('V21-02: nothing the validator rejects reaches the matcher through defineRouting', () => {
  // This is the half that matters. A round trip can only be trusted for configs
  // that survived validation, so the question is whether any public entry point
  // normalizes prefixes without validating them first.
  let rejected = 0;
  const leaks = [];

  for (const locales of LOCALE_SETS) {
    for (const prefixes of PREFIXES) {
      for (const mode of MODES) {
        const localePrefix =
          prefixes === undefined && mode === undefined ? undefined : { mode, ...(prefixes ? { prefixes } : {}) };
        try {
          validateLocalePrefix(locales, localePrefix);
          continue; // accepted: the round-trip test owns this case
        } catch {
          rejected++;
        }
        try {
          defineRouting({ locales, defaultLocale: locales[0], localePrefix });
          leaks.push({ locales: [...locales], localePrefix: JSON.stringify(localePrefix) });
        } catch {
          // rejected at the entry point too, which is what we want
        }
      }
    }
  }

  assert.ok(rejected > 300, `expected the fixtures to contain malformed configs, got ${rejected}`);
  assert.deepEqual(leaks, [], 'a config validateLocalePrefix rejects must not be usable');
});

test('V21-02: the collision the validator exists for is still refused', () => {
  // Pinned separately because it is the case the whole collision check was
  // written for: a custom prefix that lands on another locale's default prefix.
  assert.throws(
    () => validateLocalePrefix(['en', 'ru'], { prefixes: { ru: '/en' } }),
    /Duplicate locale prefix: \/en/,
    'ru: "/en" must not be allowed to impersonate the default English prefix'
  );
  assert.throws(() => defineRouting({ locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: { prefixes: { ru: '/en' } } }));
});
