import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import {
  createFluentBundle,
  createTranslator,
  createFormatter,
  clearFormatterCache,
  clearBundleCache,
  clearFunctionsCache,
  pseudoLocalizeFtl,
  generateTypeDeclarations,
  createNextFluentPlugin,
  resolveLocalizedPathname,
  formatUrlObject,
  createNavigation,
  canonicalizeLocale,
} from '../dist/index.js';

test('AUDIT-01: pseudoLocalizeFtl preserves complex selectors with functions and attributes', () => {
  const ftl = `
# Cart items selector
cart-items = { NUMBER($count) ->
    [one] 1 item
   *[other] { $count } items
}

platform-message = { PLATFORM() ->
    [macos] Press Cmd+C
   *[other] Press Ctrl+C
}
`;

  const pseudo = pseudoLocalizeFtl(ftl);
  assert.ok(pseudo.includes('{ NUMBER($count) ->'), 'Selector with NUMBER() function must be preserved intact');
  assert.ok(pseudo.includes('{ PLATFORM() ->'), 'Selector with PLATFORM() function must be preserved intact');
  assert.ok(!pseudo.includes('ÑÛÛṀƁÉÉŔ'), 'Function name must not be corrupted by pseudo-localization');
  assert.ok(!pseudo.includes('[{ NUMBER'), 'Selector line must not be wrapped in pseudo brackets');

  // Verify the generated pseudo FTL parses cleanly into a FluentBundle without syntax errors
  const bundle = createFluentBundle('en-XA', pseudo);
  const t = createTranslator(bundle);
  assert.ok(t.has('cart-items'));
  assert.ok(t.has('platform-message'));
});

test('AUDIT-02: generateTypeDeclarations deduplicates hyphenless keys and includes attributes', () => {
  const ftl = `
welcome = Welcome!
button-submit = Submit
    .tooltip = Click to submit form
    .aria-label = Submit button
`;

  const dts = generateTypeDeclarations(ftl);

  // 'welcome' should appear only ONCE in AppMessageKey
  const welcomeKeyMatches = dts.match(/'welcome'/g);
  // 'welcome' appears once in key union, once in args, once in messages = 3 times total
  assert.equal(
    welcomeKeyMatches?.length,
    3,
    'Hyphenless key "welcome" must not be duplicated within key union or interfaces'
  );

  // Both hyphenated and dotted forms should exist for button-submit
  assert.ok(dts.includes("'button-submit'"));
  assert.ok(dts.includes("'button.submit'"));

  // Attribute keys should be present and typed
  assert.ok(dts.includes("'button-submit.tooltip'"));
  assert.ok(dts.includes("'button.submit.tooltip'"));
  assert.ok(dts.includes("'button-submit.aria-label'"));
  assert.ok(dts.includes("'button.submit.aria-label'"));
});

test('AUDIT-03: createNextFluentPlugin uses project-relative Turbopack alias', () => {
  const plugin = createNextFluentPlugin('./src/i18n/request.ts');
  const result = plugin({
    webpack(config) {
      return config;
    },
  });

  assert.ok(result.turbopack?.resolveAlias?.['next-fluent/config']);
  assert.equal(result.turbopack.resolveAlias['next-fluent/config'], './src/i18n/request.ts');
  assert.equal(result.experimental?.turbo, undefined);
});

test('AUDIT-04: createTranslator formats message attributes via dot notation', () => {
  const ftl = `
dialog-confirm = Are you sure?
    .confirm = Yes, proceed with { $action }
    .cancel = Cancel

login-button =
    .label = Log In
    .tooltip = Sign into your account
`;

  const bundle = createFluentBundle('en', ftl);
  const t = createTranslator(bundle);

  // Directly format attributes with and without variables
  assert.equal(t('dialog-confirm.cancel'), 'Cancel');
  assert.equal(
    t('dialog-confirm.confirm', { action: 'checkout' }).replace(/[\u2068\u2069]/g, ''),
    'Yes, proceed with checkout'
  );

  // Dot notation mapping to hyphenated parent message ID
  assert.equal(t('dialog.confirm.cancel'), 'Cancel');
  assert.equal(t('login.button.label'), 'Log In');
  assert.equal(t('login.button.tooltip'), 'Sign into your account');

  // t.has checks attributes
  assert.equal(t.has('dialog-confirm.cancel'), true);
  assert.equal(t.has('dialog.confirm.confirm'), true);
  assert.equal(t.has('login-button.label'), true);
  assert.equal(t.has('login.button.tooltip'), true);
  assert.equal(t.has('dialog-confirm.nonexistent'), false);

  // t.raw returns attribute string directly
  assert.equal(t.raw('dialog-confirm.cancel'), 'Cancel');
  assert.equal(t.raw('login.button.label'), 'Log In');
});

test('AUDIT-05: resolveLocalizedPathname and usePathname handle trailing slashes symmetrically', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    pathnames: {
      '/about': {
        en: '/about-us',
        ru: '/o-nas',
      },
    },
  };

  // Trailing slash with and without prefix
  const withPrefix = resolveLocalizedPathname({ href: '/en/about/' }, config);
  const withoutPrefix = resolveLocalizedPathname({ href: '/about/' }, config);

  assert.equal(withPrefix, '/en/about-us/');
  assert.equal(withoutPrefix, '/en/about-us/');

  // Navigation usePathname reverse mapping with trailing slash
  const nav = createNavigation(config);
  // getPathname
  assert.equal(nav.getPathname({ href: '/about/' }), '/en/about-us/');
});

test('AUDIT-06: formatUrlObject separates embedded search/hash and filters null/undefined in query arrays', () => {
  const formatted = formatUrlObject({
    pathname: '/catalog?category=books#featured',
    query: {
      tags: ['fiction', null, undefined, 'bestseller'],
      page: 1,
    },
  });

  assert.equal(formatted.pathname, '/catalog');
  assert.ok(formatted.search.includes('tags=fiction'));
  assert.ok(formatted.search.includes('tags=bestseller'));
  assert.ok(!formatted.search.includes('null'));
  assert.ok(!formatted.search.includes('undefined'));
  assert.equal(formatted.hash, '#featured');
});

test('AUDIT-07: formatter.list handles string input without character explosion', () => {
  const formatter = createFormatter('en');
  // Pass string input
  const res = formatter.list('electronics');
  assert.equal(res, 'electronics');

  // Normal array input
  const listRes = formatter.list(['Apples', 'Oranges', 'Bananas']);
  assert.equal(listRes, 'Apples, Oranges, and Bananas');
});

test('AUDIT-08: canonicalizeLocale strips surrounding double quotes from cookies', () => {
  assert.equal(canonicalizeLocale('"en"'), 'en');
  assert.equal(canonicalizeLocale('"ru-RU"'), 'ru-RU');
  assert.equal(canonicalizeLocale('  "en_US"  '), 'en-US');
  assert.equal(canonicalizeLocale('""'), undefined);
});

test('AUDIT-09: clearBundleCache and clearFunctionsCache reset state cleanly', () => {
  clearFunctionsCache();
  clearBundleCache();
  clearFormatterCache();
  // Call functions after clearing to ensure caches re-initialize properly
  const bundle = createFluentBundle('en', 'total = { CURRENCY(15, currency: "USD") }');
  const t = createTranslator(bundle);
  assert.ok(t('total').includes('15'));
});

test('AUDIT-10: CLI next-fluent.mjs handles --help and directory pseudo-localization', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-cli-test-'));
  const inputDir = path.join(tmpDir, 'input');
  const outputDir = path.join(tmpDir, 'output');
  fs.mkdirSync(inputDir, { recursive: true });

  fs.writeFileSync(path.join(inputDir, 'app.ftl'), 'app-title = Dashboard\n', 'utf8');
  fs.writeFileSync(path.join(inputDir, 'auth.ftl'), 'login = Sign In\n', 'utf8');

  const cliPath = path.resolve('bin/next-fluent.mjs');

  // 1. Test --help
  const helpOutput = execSync(`node "${cliPath}" --help`, { encoding: 'utf8' });
  assert.ok(helpOutput.includes('Usage:'));

  // 2. Test directory pseudo-localization
  execSync(`node "${cliPath}" pseudo -i "${inputDir}" -o "${outputDir}"`, { encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(outputDir, 'app.ftl')));
  assert.ok(fs.existsSync(path.join(outputDir, 'auth.ftl')));

  const pseudoApp = fs.readFileSync(path.join(outputDir, 'app.ftl'), 'utf8');
  assert.ok(pseudoApp.includes('app-title = ['));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
