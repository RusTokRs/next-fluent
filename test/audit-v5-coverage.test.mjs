import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createNextFluentPlugin } from '../dist/plugin.js';
import { FluentServerProvider } from '../dist/server-provider.js';
import * as server from '../dist/server.js';

const silent = { onError: () => {} };

// ---------------------------------------------------------------------------
// plugin.ts — the config wrapper that wires `next-fluent/config` and typegen
// ---------------------------------------------------------------------------

test('the plugin aliases next-fluent/config for webpack and turbopack', () => {
  const withPlugin = createNextFluentPlugin('./src/i18n/request.ts');
  const config = withPlugin({ turbopack: { resolveAlias: { other: './other.ts' } } });

  assert.ok(config.turbopack.resolveAlias['next-fluent/config'].endsWith('src/i18n/request.ts'));
  assert.equal(config.turbopack.resolveAlias.other, './other.ts', 'existing aliases must survive');

  const webpackConfig = config.webpack({ resolve: { alias: { keep: 'keep' } } }, {});
  assert.ok(webpackConfig.resolve.alias['next-fluent/config'].endsWith('src/i18n/request.ts'));
  assert.equal(webpackConfig.resolve.alias.keep, 'keep');
  // The plugin owns the aliases it was asked to add, not the whole config.
  assert.equal(config.webpack({}, {}).resolve.alias.keep, undefined);
});

test('the plugin chains an existing webpack function', () => {
  const calls = [];
  const withPlugin = createNextFluentPlugin('./src/i18n/request.ts');
  const config = withPlugin({
    webpack: (inner, context) => {
      calls.push(context);
      return { ...inner, marked: true };
    },
  });

  const result = config.webpack({ resolve: { alias: {} } }, { isServer: true });
  assert.deepEqual(calls, [{ isServer: true }]);
  assert.equal(result.marked, true);
  assert.ok(result.resolve.alias['next-fluent/config']);
});

test('typegen runs while the config is evaluated', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-plugin-'));
  const previousEnv = process.env.NODE_ENV;
  // Production: the watcher must not be started (and must not hold the process).
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(dir, 'en.ftl'), 'hello = Hello\n');
  const output = path.join(dir, 'fluent.d.ts');
  const withPlugin = createNextFluentPlugin('./src/i18n/request.ts', {
    typegen: { input: dir, output },
  });
  withPlugin({});

  assert.match(fs.readFileSync(output, 'utf8'), /hello/);
});

test('a failing typegen logs instead of breaking the build', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-plugin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // `output` points inside a regular file, so writing the declarations fails.
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(String(message));
  t.after(() => {
    console.error = originalError;
  });

  const withPlugin = createNextFluentPlugin('./src/i18n/request.ts', {
    typegen: { input: dir, output: path.join(blocker, 'nested', 'fluent.d.ts') },
  });
  assert.doesNotThrow(() => withPlugin({}));
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /Type generation failed/);
});

// ---------------------------------------------------------------------------
// server-provider.ts — one request snapshot, serializable values only
// ---------------------------------------------------------------------------

test('FluentServerProvider forwards one snapshot and drops functions', async () => {
  server.setRequestConfig(() => ({
    locale: 'en',
    messages: 'greeting = Hello { $name }',
    fallbackLocale: 'en',
    fallbackMessages: 'greeting = Hi { $name }',
    defaultTranslationValues: { name: 'Ada', ignored: () => null },
    timeZone: 'UTC',
    now: new Date(0),
    formats: { number: { usd: { style: 'currency', currency: 'USD' } } },
  }));
  try {
    const element = await FluentServerProvider({
      children: React.createElement('span', null, 'child'),
    });
    assert.equal(element.type.name, 'FluentProvider');
    assert.equal(element.props.locale, 'en');
    assert.equal(element.props.timeZone, 'UTC');
    assert.equal(element.props.now.getTime(), 0);
    // A function cannot cross the RSC boundary, so only plain values are kept.
    assert.deepEqual(element.props.defaultTranslationValues, { name: 'Ada' });
    assert.ok(element.props.formats.number.usd);
  } finally {
    server.setRequestConfig(() => ({ locale: 'en', messages: '' }));
  }
});

// ---------------------------------------------------------------------------
// server.ts — request-scope fallbacks and option plumbing
// ---------------------------------------------------------------------------

test('getStaticParams exposes the configured locales', () => {
  assert.deepEqual(server.getStaticParams(['en', 'ru']), [{ locale: 'en' }, { locale: 'ru' }]);
  server.configureServerI18n({ locales: ['en', 'de'], defaultLocale: 'de' });
  assert.deepEqual(server.getStaticParams(), [{ locale: 'en' }, { locale: 'de' }]);
  server.configureServerI18n({ locales: ['en'], defaultLocale: 'en' });
});

test('getLocale falls back to the configured default outside a request scope', async () => {
  assert.equal(await server.getLocale({ locales: ['en', 'ru'], defaultLocale: 'ru' }), 'ru');
  assert.equal(
    await server.getLocale({
      locales: ['en', 'ru'],
      defaultLocale: 'ru',
      headerName: 'x-custom-locale',
      cookieNames: ['CUSTOM_LOCALE'],
    }),
    'ru'
  );
  assert.equal(await server.getLocale(), 'en');
});

// The request-scoped branches of `getLocale` (header, cookie, stored locale)
// need a React request scope: outside one, `cache()` hands back a fresh store
// on every call — verified below — so they are covered by the Next.js
// integration fixture instead.
test('outside a request scope the store is not shared', () => {
  assert.notEqual(server.getRequestStore(), server.getRequestStore());
});

test('setRequestLocale validates its input', () => {
  assert.throws(() => server.setRequestLocale('not a locale!'), /Invalid request locale/);
  assert.throws(() => server.setRequestLocale('fr', ['en', 'ru']), /Unsupported request locale/);
});

test('setRequestLocale outside a request scope warns in production', (t) => {
  const previousEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });

  server.configureServerI18n({ locales: ['en', 'ru'], defaultLocale: 'en' });
  t.after(() => server.configureServerI18n({ locales: ['en'], defaultLocale: 'en' }));

  process.env.NODE_ENV = 'development';
  assert.throws(() => server.setRequestLocale('ru'), /outside a request scope/);

  process.env.NODE_ENV = 'production';
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  t.after(() => {
    console.warn = original;
  });
  assert.doesNotThrow(() => server.setRequestLocale('ru'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /outside a request scope/);
});

test('the request config rejects malformed results', async () => {
  server.setRequestConfig(() => ({ locale: 'en', messages: 42 }));
  await assert.rejects(() => server.getMessages('en'), /must return messages/);

  server.setRequestConfig(() => ({ locale: 'not a locale!', messages: 'a = A' }));
  await assert.rejects(() => server.getMessages('en'), /invalid locale/);

  server.setRequestConfig(() => ({ locale: 'en', messages: 'a = A' }));
});

test('getFormats resolves presets from the request config', async () => {
  server.setRequestConfig(() => ({
    locale: 'en',
    messages: 'a = A',
    formats: { number: { eur: { style: 'currency', currency: 'EUR' } } },
  }));
  try {
    const formats = await server.getFormats();
    assert.ok(formats.number.eur);
  } finally {
    server.setRequestConfig(() => ({ locale: 'en', messages: '' }));
  }
});

test('getRequestConfigSnapshot fills in time zone, now and locale', async () => {
  server.setRequestConfig(() => ({ locale: 'en', messages: 'a = A', timeZone: 'UTC', now: new Date(0) }));
  try {
    const snapshot = await server.getRequestConfigSnapshot('en');
    assert.equal(snapshot.locale, 'en');
    assert.equal(snapshot.timeZone, 'UTC');
    assert.equal(snapshot.now.getTime(), 0);
  } finally {
    server.setRequestConfig(() => ({ locale: 'en', messages: '' }));
  }
});

test('forLocale threads instance options without touching the shared store', async () => {
  const seen = [];
  const t = await server.forLocale('en', {
    messages: 'greeting = Hello { $name }',
    fallbackMessages: 'greeting = Hi { $name }',
    namespace: undefined,
    debug: true,
    strictNamespace: true,
    useIsolating: false,
    functions: { shout: (value) => String(value).toUpperCase() },
    onError: (error) => seen.push(error.code),
    getMessageFallback: ({ key }) => `<${key}>`,
    defaultTranslationValues: { name: 'Ada' },
  });

  assert.equal(t('greeting'), 'Hello Ada');
  assert.equal(t('missing'), '<missing>');
  assert.ok(seen.length > 0, 'onError must be wired');
});

test('forLocale honours a namespace and an instance request config', async () => {
  const calls = [];
  const t = await server.forLocale('ru', {
    namespace: 'checkout',
    requestConfig: async ({ locale }) => {
      calls.push(locale);
      return { locale, messages: 'checkout-title = Oplata\ncheckout-total = { $sum }' };
    },
  });

  assert.equal(t('title'), 'Oplata');
  assert.deepEqual(calls, ['ru']);
});

test('getTranslations works with an explicit messages override', async () => {
  const t = await server.getTranslations({ locale: 'en', messages: 'a = A' });
  assert.equal(t('a'), 'A');
  void silent;
});

// ---------------------------------------------------------------------------
// client.ts — provider surface beyond the happy path
// ---------------------------------------------------------------------------

test('the provider exposes locale, messages, formatter and fallback bundles', async () => {
  const { FluentProvider, FormattedMessage, useFormatter, useLocale, useMessages, useNow, useTimeZone } =
    await import('../dist/client.js');

  function Probe() {
    const locale = useLocale();
    const messages = useMessages();
    const timeZone = useTimeZone();
    const now = useNow();
    const formatter = useFormatter();
    return React.createElement(
      'span',
      null,
      [
        locale,
        typeof messages,
        timeZone,
        Number.isNaN(now.getTime()) ? 'invalid' : 'date',
        formatter.number(1234.5),
      ].join('|')
    );
  }

  const html = renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      {
        locale: 'en',
        messages: 'label = Text',
        fallbackMessages: ['fallback = Fallback'],
        timeZone: 'UTC',
        now: new Date(0),
        formats: { number: { compact: { notation: 'compact' } } },
      },
      React.createElement(
        'div',
        null,
        React.createElement(Probe),
        React.createElement(FormattedMessage, { id: 'fallback', as: 'strong', className: 'x' })
      )
    )
  );

  assert.match(html, /^<div><span>en\|string\|UTC\|date\|1,234\.5<\/span><strong class="x">/);
});

// ---------------------------------------------------------------------------
// catalog-io.ts — broken catalogs and the fs.watch path
// ---------------------------------------------------------------------------

test('a broken JSON catalog names the offending file', async () => {
  const { readCatalog } = await import('../dist/catalog-io.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-json-'));
  try {
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{"app":');
    assert.throws(() => readCatalog(file), /Cannot read the catalog .*broken\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watchCatalogs regenerates on change and reports a missing directory', async (t) => {
  const { watchCatalogs } = await import('../dist/catalog-io.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-fluent-watch-'));
  const output = path.join(dir, 'fluent.d.ts');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, 'en.ftl'), 'first = One\n');
  const stop = watchCatalogs(dir, output, {});
  try {
    // `fs.watch` reports changes only; the first snapshot is written by the
    // CLI/plugin, not by the watcher.
    fs.writeFileSync(path.join(dir, 'en.ftl'), 'first = One\nsecond = Two\n');
    const deadline = Date.now() + 5000;
    while (
      (!fs.existsSync(output) || !fs.readFileSync(output, 'utf8').includes('second')) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(fs.existsSync(output), 'the watcher must generate the declarations');
    assert.match(fs.readFileSync(output, 'utf8'), /second/);
  } finally {
    stop();
  }

  // `fs.watch` on a missing directory throws on Linux/Node 22 but stays silent
  // on Node 24 and Windows, so the check must not depend on the platform.
  const errors = [];
  const missing = path.join(dir, 'missing');
  const failed = watchCatalogs(missing, output, {
    onError: (error) => errors.push(error.message),
  });
  failed();
  assert.equal(errors.length, 1, 'watching a missing directory must report through onError');
  assert.match(errors[0], /not a directory/);
  assert.ok(errors[0].includes(missing), 'the message names the directory');
});
