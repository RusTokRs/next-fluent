import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNavigation,
  resolveLocalizedPathname,
  formatUrlObject,
} from '../dist/navigation.js';

test('resolveLocalizedPathname applies "always" prefix strategy', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  assert.equal(resolveLocalizedPathname({ href: '/', locale: 'en' }, config), '/en');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'en' }, config), '/en/about');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'ru' }, config), '/ru/about');

  // Strip existing prefix when switching locales
  assert.equal(resolveLocalizedPathname({ href: '/en/about', locale: 'ru' }, config), '/ru/about');
  assert.equal(resolveLocalizedPathname({ href: '/ru/orders/123', locale: 'en' }, config), '/en/orders/123');
});

test('resolveLocalizedPathname applies "as-needed" prefix strategy', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  };

  // Default locale has no prefix
  assert.equal(resolveLocalizedPathname({ href: '/', locale: 'en' }, config), '/');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'en' }, config), '/about');

  // Non-default locale has prefix
  assert.equal(resolveLocalizedPathname({ href: '/', locale: 'ru' }, config), '/ru');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'ru' }, config), '/ru/about');

  // Strip prefix when switching to default locale
  assert.equal(resolveLocalizedPathname({ href: '/ru/about', locale: 'en' }, config), '/about');

  // Strip default prefix if accidentally included
  assert.equal(resolveLocalizedPathname({ href: '/en/about', locale: 'en' }, config), '/about');
});

test('resolveLocalizedPathname applies "never" prefix strategy', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'never',
  };

  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'en' }, config), '/about');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'ru' }, config), '/about');
  assert.equal(resolveLocalizedPathname({ href: '/ru/about', locale: 'ru' }, config), '/about');
});

test('resolveLocalizedPathname preserves query params, hash fragments, and handles UrlObject', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  // String with query and hash
  const strResult = resolveLocalizedPathname(
    { href: '/products?sort=desc#reviews', locale: 'ru' },
    config
  );
  assert.equal(strResult, '/ru/products?sort=desc#reviews');

  // UrlObject with query and hash
  const objResult = resolveLocalizedPathname(
    {
      href: {
        pathname: '/search',
        query: { q: 'laptop', page: '1' },
        hash: 'results',
      },
      locale: 'en',
    },
    config
  );
  assert.equal(objResult, '/en/search?q=laptop&page=1#results');
});

test('resolveLocalizedPathname leaves external URLs unchanged', () => {
  const config = {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'always',
  };

  assert.equal(
    resolveLocalizedPathname({ href: 'https://example.com/docs', locale: 'ru' }, config),
    'https://example.com/docs'
  );
  assert.equal(
    resolveLocalizedPathname({ href: 'http://localhost:3000', locale: 'en' }, config),
    'http://localhost:3000'
  );
  assert.equal(
    resolveLocalizedPathname({ href: 'mailto:info@example.com', locale: 'ru' }, config),
    'mailto:info@example.com'
  );
  assert.equal(
    resolveLocalizedPathname({ href: '//cdn.example.com/logo.png', locale: 'en' }, config),
    '//cdn.example.com/logo.png'
  );
});

test('formatUrlObject correctly serializes pathname, search, and hash', () => {
  const formatted = formatUrlObject({
    pathname: 'items',
    query: { filter: ['a', 'b'], limit: 10 },
    hash: 'list',
  });

  assert.equal(formatted.pathname, '/items');
  assert.ok(formatted.search.includes('filter=a') && formatted.search.includes('filter=b'));
  assert.ok(formatted.search.includes('limit=10'));
  assert.equal(formatted.hash, '#list');
});

test('createNavigation returns expected navigation instance and throws on invalid config', () => {
  assert.throws(() => {
    createNavigation({ locales: [], defaultLocale: 'en' });
  }, /non-empty array/);

  const nav = createNavigation({
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    localePrefix: 'as-needed',
  });

  assert.equal(typeof nav.Link, 'object'); // React forwardRef component
  assert.equal(typeof nav.usePathname, 'function');
  assert.equal(typeof nav.useRouter, 'function');
  assert.equal(typeof nav.redirect, 'function');
  assert.equal(typeof nav.permanentRedirect, 'function');
  assert.equal(typeof nav.getPathname, 'function');

  assert.equal(nav.getPathname({ href: '/dashboard', locale: 'ru' }), '/ru/dashboard');
  assert.equal(nav.getPathname({ href: '/dashboard', locale: 'en' }), '/dashboard');
});
