/**
 * Audit pass 19 — see ENGINEERING_AUDIT_V19.md.
 *
 * V18 pointed the next pass at `server.js`, the least covered module in `src/`.
 * Reading it found the one configuration entry point in the package that
 * validated nothing, and whose silence decided which locale the server
 * rendered. The pass also closes a functionality gap (writing direction) and
 * pins an asymmetry that looks like a bug but is not — `prefetch` deliberately
 * skips the signal URL that `push` uses.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import test from 'node:test';

import * as server from '../dist/server.js';
import { defineRouting } from '../dist/routing.js';
import { createNavigation } from '../dist/navigation.js';
import { getLocaleDirection } from '../dist/utils.js';
import { FluentProvider } from '../dist/client.js';
import { switchLocaleHref } from '../dist/nav-url.js';

const BASELINE = { locales: ['en'], defaultLocale: 'en' };

/**
 * `configureServerI18n` writes module-level globals, so every test that calls
 * it must put them back — otherwise a later test inherits a locale list it
 * never configured and passes or fails for the wrong reason.
 */
function restoreConfigAfter(t) {
  t.after(() => server.configureServerI18n(BASELINE));
}

// ---------------------------------------------------------------------------
// V19-01: configureServerI18n was the only unvalidated configuration entry point
// ---------------------------------------------------------------------------

test('V19-01: locales without a usable default are rejected, not silently defaulted to "en"', (t) => {
  restoreConfigAfter(t);
  // Before the pass this was accepted, and every request whose locale was not
  // pinned resolved to `en` — a locale the app does not ship.
  assert.throws(
    () => server.configureServerI18n({ locales: ['ru', 'de'] }),
    /"defaultLocale" \("en"\) must be included in "locales" \[ru, de\]/
  );
});

test('V19-01: an unusable locale list or default is rejected at the call site', (t) => {
  restoreConfigAfter(t);
  const cases = [
    [{ locales: ['ru'], defaultLocale: 'not a tag!' }, /Invalid "defaultLocale"/],
    [{ locales: ['!!!'], defaultLocale: 'ru' }, /Invalid locale tag in "locales"/],
    [{ locales: ['en', 'EN'], defaultLocale: 'en' }, /Duplicate locale identity/],
    [{ locales: ['ru', 'de'], defaultLocale: 'en' }, /must be included in "locales"/],
  ];

  for (const [config, message] of cases) {
    assert.throws(
      () => server.configureServerI18n(config),
      message,
      `expected ${JSON.stringify(config)} to be rejected`
    );
  }
});

test('V19-01: a valid configuration is still accepted, canonical spellings included', (t) => {
  restoreConfigAfter(t);
  assert.doesNotThrow(() => server.configureServerI18n({ locales: ['ru', 'de'], defaultLocale: 'de' }));
  // A canonical identity may be spelled in any case, exactly as everywhere else
  // in the package: `en-us` satisfies a list that says `en-US`.
  assert.doesNotThrow(() => server.configureServerI18n({ locales: ['en-US', 'ru'], defaultLocale: 'en-us' }));
  // Once a list is configured, a default outside it is rejected — the same rule
  // the explicit pair above is held to.
  assert.throws(
    () => server.configureServerI18n({ defaultLocale: 'pt-BR' }),
    /must be included in "locales" \[en-US, ru\]/
  );
});

test('V19-01: a default set before any locale list is checked as a tag', async () => {
  // The "no locale list configured yet" branch reads module globals, so it is
  // only reachable in a process nothing else has configured. Measured in a
  // child rather than faked by reordering tests.
  // A file URL, not a POSIX-ified path: on Windows `D:/a/.../server.js` parses
  // as a URL with the scheme `d:`, and the child dies with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME before the assertion is ever reached.
  const module = pathToFileURL(path.resolve('dist/server.js')).href;
  const run = (code) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        ['--input-type=module', '-e', `import { configureServerI18n } from '${module}';\n${code}`],
        (error, stdout, stderr) => resolve({ error, out: `${stdout}${stderr}` })
      );
    });

  const valid = await run("configureServerI18n({ defaultLocale: 'pt-BR' }); console.log('accepted');");
  assert.equal(valid.error, null, valid.out);
  assert.match(valid.out, /accepted/);

  const invalid = await run("configureServerI18n({ defaultLocale: 'nope!!' });");
  assert.match(invalid.out, /Invalid "defaultLocale": "nope!!"/);
});

test('V19-01: the server entry point validates the way every other entry point does', (t) => {
  restoreConfigAfter(t);
  // The defect was an asymmetry, so the gate is the asymmetry: the same pair
  // must be judged identically by `configureServerI18n` and by the validator
  // `defineRouting` already ran.
  const pairs = [
    { locales: ['ru', 'de'], defaultLocale: 'en' },
    { locales: ['en', 'EN'], defaultLocale: 'en' },
    { locales: ['!!!'], defaultLocale: 'ru' },
    { locales: ['ru', 'de'], defaultLocale: 'de' },
    { locales: ['en', 'ru'], defaultLocale: 'en' },
  ];

  for (const pair of pairs) {
    let routingRejected = false;
    try {
      defineRouting(pair);
    } catch {
      routingRejected = true;
    }
    let serverRejected = false;
    try {
      server.configureServerI18n(pair);
    } catch {
      serverRejected = true;
    }
    assert.equal(
      serverRejected,
      routingRejected,
      `${JSON.stringify(pair)}: defineRouting ${routingRejected ? 'rejects' : 'accepts'} but configureServerI18n ${serverRejected ? 'rejects' : 'accepts'}`
    );
  }
  server.configureServerI18n({ locales: ['en'], defaultLocale: 'en' });
});

test('V19-01: getLocale() can no longer resolve to a locale the app does not ship', async (t) => {
  restoreConfigAfter(t);
  server.configureServerI18n({ locales: ['ru', 'de'], defaultLocale: 'de' });
  const locale = await server.getLocale();
  assert.ok(['ru', 'de'].includes(locale), `resolved to ${locale}, which is not configured`);
});

// ---------------------------------------------------------------------------
// V19-02: prefetch/push asymmetry — verified intentional, now pinned
// ---------------------------------------------------------------------------

function routerFor(config, providerLocale, calls) {
  const nav = createNavigation(config);
  let router;
  function Probe() {
    router = nav.useRouter();
    return null;
  }
  const nextRouter = Object.fromEntries(
    ['push', 'replace', 'prefetch'].map((name) => [name, (...args) => calls.push([name, ...args])])
  );
  renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale: providerLocale, messages: 'x = X' },
      React.createElement(AppRouterContext.Provider, { value: nextRouter }, React.createElement(Probe))
    )
  );
  return router;
}

const asNeeded = {
  locales: ['en', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: false,
  pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } },
};

test('V19-02: prefetch warms the canonical URL that the signal redirect lands on', () => {
  // `push` and `prefetch` do not build the same string, and that is correct:
  // the signal URL exists only so the middleware can tell an explicit switch
  // from an ordinary visit, and it canonicalizes it *with a redirect*. The URL
  // carrying the page payload is the canonical one — the one prefetch warms.
  const pushes = [];
  routerFor(asNeeded, 'en', pushes).push('/about', { locale: 'en' });
  const prefetches = [];
  routerFor(asNeeded, 'en', prefetches).prefetch('/about', { locale: 'en' });

  const signal = pushes[0][1];
  const warmed = prefetches[0][1];
  assert.equal(signal, '/en/about-us', 'the switch navigates through a signal URL');
  assert.equal(warmed, '/about-us', 'prefetch warms the canonical destination');
  assert.notEqual(signal, warmed);

  // The signal is a prefix, i.e. exactly what the middleware strips to reach
  // the warmed URL — the two agree on where the request ends up.
  assert.equal(signal.slice('/en'.length), warmed);
  assert.equal(
    switchLocaleHref(warmed, 'en', asNeeded),
    signal,
    'the canonical URL must be what the signal redirects back to'
  );
});

test('V19-02: prefetch and push agree outright when no signal is needed', () => {
  // Switching to a non-default locale in `as-needed` produces a prefixed
  // canonical href, which is already unambiguous — no signal, no asymmetry.
  const pushes = [];
  routerFor(asNeeded, 'en', pushes).push('/about', { locale: 'ru' });
  const prefetches = [];
  routerFor(asNeeded, 'en', prefetches).prefetch('/about', { locale: 'ru' });
  // `push` forwards Next's router options as a second argument, hence the
  // trailing `undefined`; the URL is the part under test.
  assert.deepEqual(pushes[0].slice(0, 2), ['push', '/ru/o-nas']);
  assert.deepEqual(prefetches[0], ['prefetch', '/ru/o-nas']);
  assert.equal(pushes[0][1], prefetches[0][1]);
});

// ---------------------------------------------------------------------------
// V19-03: writing direction
// ---------------------------------------------------------------------------

test('V19-03: right-to-left locales are reported as rtl', () => {
  for (const locale of ['ar', 'he', 'fa', 'ur', 'ar-EG', 'he-IL', 'ps', 'yi', 'dv']) {
    assert.equal(getLocaleDirection(locale), 'rtl', locale);
  }
});

test('V19-03: everything else is ltr, including tags Intl cannot place', () => {
  for (const locale of ['en', 'ru', 'de', 'pt-BR', 'zh-Hans', 'ja', 'th']) {
    assert.equal(getLocaleDirection(locale), 'ltr', locale);
  }
  // Guessing left-to-right is the direction that degrades readably; a layout
  // render is not the place to throw over a bad tag.
  for (const locale of ['zz', '', 'not a tag!', 'en-US-u-nu-thai']) {
    assert.equal(getLocaleDirection(locale), 'ltr', JSON.stringify(locale));
  }
});

test('V19-03: direction is spelled the same way as the tag is matched elsewhere', () => {
  // Locale matching across the package is canonical and case-insensitive, so
  // the direction of `AR-eg` cannot differ from `ar-EG`.
  assert.equal(getLocaleDirection('AR-EG'), getLocaleDirection('ar-EG'));
  assert.equal(getLocaleDirection('HE_il'), 'rtl');
});

test('V19-03: direction is reachable from the package root', async () => {
  const root = await import('../dist/index.js');
  assert.equal(typeof root.getLocaleDirection, 'function');
  assert.equal(root.getLocaleDirection('ar'), 'rtl');

  // The documented client surface has to carry it too, or a Client Component
  // cannot render `<html dir>` from a locale it already has.
  const declaration = fs.readFileSync(path.resolve('dist/index.d.ts'), 'utf8');
  assert.match(declaration, /getLocaleDirection/);
  assert.match(declaration, /LocaleDirection/);
});
