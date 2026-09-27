import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRouting } from '../dist/routing.js';
import { createNavigation } from '../dist/navigation.js';
import { createI18nMiddleware } from '../dist/middleware.js';
import { createI18n } from '../dist/factory.js';

const factories = [defineRouting, createNavigation, createI18nMiddleware, createI18n];
const base = { locales: ['en', 'ru'], defaultLocale: 'en' };

for (const mode of ['always', 'as-needed', 'never']) {
  test(`${mode}: custom prefixes cannot collide with implicit defaults`, () => {
    for (const prefixes of [{ ru: '/en' }, { ru: '/EN' }, { ru: '/en/region' }, { en: '/ru' }]) {
      for (const factory of factories) {
        assert.throws(() => factory({ ...base, localePrefix: { mode, prefixes } }),
          /Duplicate locale prefix|Ambiguous locale prefixes/, `${factory.name}: ${JSON.stringify(prefixes)}`);
      }
    }
  });
}

test('overridden defaults are not incorrectly kept in the collision table', () => {
  const routing = defineRouting({ ...base,
    localePrefix: { prefixes: { en: '/english', ru: '/en' } },
  });
  const nav = createNavigation(routing);
  assert.equal(nav.getPathname({ href: '/docs', locale: 'ru' }), '/en/docs');
  assert.equal(nav.getPathname({ href: '/docs', locale: 'en' }), '/english/docs');
  assert.doesNotThrow(() => defineRouting({ ...base,
    localePrefix: { prefixes: { ru: '/english' } },
  }), 'similar text without a segment boundary is not prefix shadowing');
});

test('canonical prefix keys override the configured spelling before collision checks', () => {
  for (const factory of factories) {
    assert.throws(() => factory({
      locales: ['en', 'pt-BR'], defaultLocale: 'en',
      localePrefix: { prefixes: { en: '/pt-BR' } },
    }), /Duplicate locale prefix/);
    assert.doesNotThrow(() => factory({
      locales: ['en', 'pt-BR'], defaultLocale: 'en',
      localePrefix: { prefixes: { en: '/pt-BR', pt_br: '/brasil' } },
    }));
  }
});

test('domain overrides validate effective defaults using global locale spelling', () => {
  for (const factory of factories) {
    assert.throws(() => factory({ ...base, domains: [{
      domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'],
      localePrefix: { prefixes: { ru: '/en' } },
    }] }), /Duplicate locale prefix/);
    assert.throws(() => factory({
      locales: ['en', 'pt-BR', 'ru'], defaultLocale: 'en', domains: [{
        domain: 'example.com', defaultLocale: 'pt_br', locales: ['pt_br', 'ru'],
        localePrefix: { prefixes: { ru: '/pt-BR' } },
      }],
    }), /Duplicate locale prefix/);
  }
});

test('separate domains can reuse a prefix without a global collision', () => {
  for (const factory of factories) {
    assert.doesNotThrow(() => factory({ ...base, domains: [
      { domain: 'example.com', defaultLocale: 'en', localePrefix: { prefixes: { en: '/site' } } },
      { domain: 'example.ru', defaultLocale: 'ru', localePrefix: { prefixes: { ru: '/site' } } },
    ] }));
  }
});


test('effective prefix validation shares normalization first-alias precedence', () => {
  const routing = defineRouting({ locales: ['en-US', 'ru'], defaultLocale: 'en-US',
    localePrefix: { prefixes: { en_US: '/usa', 'EN-US': '/ru' } },
  });
  assert.equal(createNavigation(routing).getPathname({ href: '/docs', locale: 'en-US' }), '/usa/docs');
  assert.equal(createNavigation(routing).getPathname({ href: '/docs', locale: 'ru' }), '/ru/docs');
});
