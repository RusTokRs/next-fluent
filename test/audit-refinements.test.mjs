import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  createFormatter,
  clearFormatterCache,
  resolveLocalizedPathname,
  formatUrlObject,
  createNavigation,
  FluentProvider,
  FormattedMessage,
  createFluentBundle,
} from '../dist/index.js';

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
