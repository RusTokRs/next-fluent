import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  createFluentBundle,
  createTranslator,
  getStaticParams,
  getTimeZone,
  getNow,
  createI18n,
} from '../dist/index.js';

test('getStaticParams maps configured locales to static route param objects', () => {
  const params = getStaticParams(['en', 'ru', 'de']);
  assert.deepEqual(params, [
    { locale: 'en' },
    { locale: 'ru' },
    { locale: 'de' },
  ]);

  // Default global locales fallback (defaults to ['en'])
  const defaultParams = getStaticParams();
  assert.ok(Array.isArray(defaultParams));
  assert.ok(defaultParams.some((p) => p.locale === 'en'));
  assert.equal(defaultParams.length, 1);
});

test('getTimeZone and getNow return valid runtime values', () => {
  const tz = getTimeZone();
  assert.equal(typeof tz, 'string');
  assert.ok(tz.length > 0);

  const now = getNow();
  assert.ok(now instanceof Date);
  assert.ok(!Number.isNaN(now.getTime()));
});

test('defaultTranslationValues interpolates global values and tags in createTranslator', () => {
  const ftl = `
welcome = Welcome to { $company }, { $name }!
notice = Please read our <terms>terms</terms> and <privacy>privacy</privacy>.
`;
  const bundle = createFluentBundle('en', ftl, { useIsolating: false });

  const t = createTranslator(bundle, {
    defaultTranslationValues: {
      company: 'NextFluent Platform',
      terms: (chunks) => `[TERMS: ${chunks}]`,
    },
  });

  // Global $company is used when not passed at call-time
  const msg = t('welcome', { name: 'Alice' });
  assert.equal(msg, 'Welcome to NextFluent Platform, Alice!');

  // Global <terms> tag is used automatically, call-time <privacy> tag is merged
  const richNotice = t.rich('notice', {
    privacy: (chunks) => `[PRIVACY: ${chunks}]`,
  });

  assert.ok(React.isValidElement(richNotice));
  const children = React.Children.toArray(richNotice.props.children);
  const stringified = children.join('');

  assert.ok(stringified.includes('[TERMS: terms]'));
  assert.ok(stringified.includes('[PRIVACY: privacy]'));
});

test('call-time translation values override defaultTranslationValues', () => {
  const ftl = 'header = Powered by { $platform }';
  const bundle = createFluentBundle('en', ftl, { useIsolating: false });

  const t = createTranslator(bundle, {
    defaultTranslationValues: {
      platform: 'NextFluent Default',
    },
  });

  assert.equal(t('header'), 'Powered by NextFluent Default');
  assert.equal(t('header', { platform: 'NextFluent Custom' }), 'Powered by NextFluent Custom');
});

test('createI18n exposes getFormatter, getStaticParams, and navigation on runtime', async () => {
  const runtime = createI18n({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  });

  // getStaticParams
  const staticParams = runtime.getStaticParams();
  assert.deepEqual(staticParams, [{ locale: 'en' }, { locale: 'ru' }]);

  // getFormatter
  const formatter = await runtime.getFormatter();
  assert.equal(typeof formatter.dateTime, 'function');
  assert.equal(typeof formatter.number, 'function');
  assert.equal(typeof formatter.relativeTime, 'function');
  assert.equal(typeof formatter.list, 'function');

  assert.equal(formatter.number(1234.5, { maximumFractionDigits: 1 }), '1,234.5');

  // navigation
  assert.ok(runtime.navigation);
  assert.equal(typeof runtime.navigation.getPathname, 'function');
  assert.equal(typeof runtime.navigation.Link, 'object');

  const localizedPath = runtime.navigation.getPathname({ href: '/shop', locale: 'ru' });
  assert.equal(localizedPath, '/ru/shop');
});
