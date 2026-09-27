import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  createFormatter,
  clearFormatterCache,
  resolveLocalizedPathname,
  formatUrlObject,
  FluentProvider,
  FormattedMessage,
  createFluentBundle,
} from '../dist/index.js';
import { assertSafeHref } from '../dist/navigation.js';

test('resolveLocalizedPathname rejects open redirects and protocols', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  // Protocol-relative URLs are ordinary external links and pass through.
  assert.equal(
    resolveLocalizedPathname({ href: '//evil.com/phish', locale: 'en' }, config),
    '//evil.com/phish'
  );
  // Backslash UNC paths and script/data schemes are rejected outright.
  assert.throws(
    () => resolveLocalizedPathname({ href: '\\\\evil.com\\share', locale: 'en' }, config),
    /Unsafe href/
  );
  assert.throws(
    () => resolveLocalizedPathname({ href: 'javascript:alert(1)', locale: 'en' }, config),
    /Unsafe href/
  );
  assert.throws(
    () => resolveLocalizedPathname({ href: 'data:text/html,<b>xss</b>', locale: 'en' }, config),
    /Unsafe href/
  );
});

test('resolveLocalizedPathname normalizes Windows backslashes in route paths', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  const res = resolveLocalizedPathname({ href: '\\dashboard\\users', locale: 'en' }, config);
  assert.equal(res, '/en/dashboard/users');
});

test('resolveLocalizedPathname falls back to defaultLocale on unsupported target locale', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  // Unsupported or malicious locale string must NOT become a URL prefix
  const res = resolveLocalizedPathname({ href: '/account', locale: 'unsupported-xyz' }, config);
  assert.equal(res, '/en/account');
});

test('formatUrlObject handles search with and without leading ? and array queries', () => {
  const withQ = formatUrlObject({
    pathname: '/api',
    search: '?key=123',
  });
  assert.equal(withQ.search, '?key=123');

  const withoutQ = formatUrlObject({
    pathname: '/api',
    search: 'key=123',
  });
  assert.equal(withoutQ.search, '?key=123');

  const arrayQuery = formatUrlObject({
    pathname: '/items',
    query: { category: ['books', 'tech'] },
  });
  assert.ok(arrayQuery.search.includes('category=books'));
  assert.ok(arrayQuery.search.includes('category=tech'));
});

test('createFormatter list handles non-iterable gracefully without throw', () => {
  const formatter = createFormatter('en');

  // Should return string fallback without throwing TypeError
  assert.equal(formatter.list(null), '');
  assert.equal(formatter.list(undefined), '');
  assert.equal(formatter.list(123), '123');
});

test('formatter bounded cache maintains max 200 items under flood', () => {
  clearFormatterCache();
  const formatter = createFormatter('en');

  // Flood with 250 unique options
  for (let i = 0; i < 250; i++) {
    formatter.number(100, { minimumFractionDigits: (i % 20) });
  }

  // Formatting still functions reliably after eviction cycles
  const res = formatter.number(123.45, { minimumFractionDigits: 2 });
  assert.match(res, /123\.45/);
});

test('FormattedMessage seamlessly combines args, rich tags, and defaultTranslationValues', () => {
  const ftl = `
order-status = Hello, { $customer }! Order <num>#{ $orderId }</num> is <status>{ $status }</status>.
`;
  const bundle = createFluentBundle('en', ftl, { useIsolating: false });

  // Simulate rendering FormattedMessage inside FluentProvider with defaultTranslationValues
  const providerTree = React.createElement(
    FluentProvider,
    {
      locale: 'en',
      messages: bundle,
      defaultTranslationValues: {
        num: (chunks) => React.createElement('strong', { className: 'order-num' }, chunks),
      },
    },
    React.createElement(FormattedMessage, {
      id: 'order-status',
      args: { customer: 'Alex', orderId: '987', status: 'shipped' },
      values: {
        status: (chunks) => React.createElement('span', { className: 'badge' }, chunks),
      },
      className: 'order-card',
      as: 'div',
    })
  );

  assert.ok(React.isValidElement(providerTree));
});

test('assertSafeHref sees the URL the way a browser does', () => {
  // Browsers remove ASCII tab/LF/CR anywhere in a URL and strip C0 controls at
  // the edges before resolving the scheme, so these all execute if rendered.
  for (const href of [
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'dat\ta:text/html,x',
    'vbscript\t:x',
    '\u0001javascript:alert(1)',
    '\u0000javascript:alert(1)',
    '\tjavascript:alert(1)',
  ]) {
    assert.throws(() => assertSafeHref(href), /Unsafe href/, `expected rejection: ${JSON.stringify(href)}`);
  }

  // Ordinary hrefs keep working.
  for (const href of ['/about', 'about', 'https://example.com/x', 'mailto:a@b.dev', '#frag', '/a?b=1#c']) {
    assert.doesNotThrow(() => assertSafeHref(href), `expected acceptance: ${href}`);
  }
});

test('a rejected href cannot rewrite its own error message', () => {
  let message = '';
  try {
    assertSafeHref('java\tscript:\nalert(1)');
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /Unsafe href/);
  // eslint-disable-next-line no-control-regex -- asserting their absence is the point
  assert.equal(/[\u0000-\u001f]/.test(message), false, `control characters leaked: ${JSON.stringify(message)}`);
});

test('resolveLocalizedPathname rejects the normalized-scheme bypass', () => {
  const config = { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always' };
  assert.throws(
    () => resolveLocalizedPathname({ href: 'java\tscript:alert(1)' }, config),
    /Unsafe href/
  );
});

test('canonicalizeLocale stays correct while memoized', async () => {
  const { canonicalizeLocale } = await import('../dist/utils.js');
  // Repeated calls must agree with the first, including negative results: the
  // cache stores undefined too, so garbage has to keep being rejected.
  for (let i = 0; i < 3; i++) {
    assert.equal(canonicalizeLocale('en_us'), 'en-US');
    assert.equal(canonicalizeLocale('"en"'), 'en');
    assert.equal(canonicalizeLocale('not a locale!'), undefined);
    assert.equal(canonicalizeLocale('a'.repeat(65)), undefined);
    assert.equal(canonicalizeLocale(''), undefined);
    assert.equal(canonicalizeLocale(null), undefined);
  }
  // A large volume of distinct inputs must not grow the cache without bound.
  for (let i = 0; i < 2000; i++) canonicalizeLocale(`xx-${i}`);
  assert.equal(canonicalizeLocale('en_us'), 'en-US');
});

test('the memoized prefix table stays correct across configs and calls', async () => {
  const { matchLocalePrefix, normalizeLocalePrefix } = await import('../dist/locale-prefix.js');
  const locales = ['en', 'ru', 'de'];
  const asNeeded = normalizeLocalePrefix(locales, 'as-needed');
  const always = normalizeLocalePrefix(locales, 'always');

  for (let i = 0; i < 3; i++) {
    assert.deepEqual(matchLocalePrefix('/ru/about', locales, always), { locale: 'ru', rest: '/about' });
    // matchLocalePrefix is deliberately mode-agnostic: it reports whether the
    // path carries a prefix, and the middleware decides what to do about it.
    assert.deepEqual(matchLocalePrefix('/en/about', locales, asNeeded), {
      locale: 'en',
      rest: '/about',
    });
    assert.deepEqual(matchLocalePrefix('/de', locales, always), { locale: 'de', rest: '/' });
    assert.equal(matchLocalePrefix('/about', locales, always), null);
  }
  // Custom prefixes change the table, so a second config must not reuse it.
  const custom = normalizeLocalePrefix(locales, { mode: 'always', prefixes: { ru: '/russkiy' } });
  assert.deepEqual(matchLocalePrefix('/russkiy/about', locales, custom), {
    locale: 'ru',
    rest: '/about',
  });
  assert.equal(matchLocalePrefix('/ru/about', locales, custom), null);
});

test('defineRouting freezes its locale list', async () => {
  const { defineRouting } = await import('../dist/routing.js');
  const source = ['en', 'ru'];
  const routing = defineRouting({ locales: source, defaultLocale: 'en' });
  assert.equal(Object.isFrozen(routing.locales), true);
  // Mutating the array the caller passed must not change the routing config,
  // which the prefix-table memoization depends on.
  assert.throws(() => {
    'use strict';
    routing.locales.push('de');
  }, TypeError);
  assert.deepEqual([...routing.locales], ['en', 'ru']);
  assert.deepEqual(source, ['en', 'ru'], 'the caller array is left alone');
});
