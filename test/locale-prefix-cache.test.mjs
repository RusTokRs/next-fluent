import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { normalizeLocalePrefix, matchLocalePrefix } from '../dist/locale-prefix.js';

// Keep GC out of the main runner: --expose-gc is only needed in this child,
// and a new process prevents concurrent test activity from affecting it.
test('prefix table cache does not retain temporary configs for a live locales array', () => {
  const moduleUrl = new URL('../dist/locale-prefix.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { setImmediate } from 'node:timers/promises';
    import { normalizeLocalePrefix, matchLocalePrefix } from ${JSON.stringify(moduleUrl)};
    const locales = ['en', 'ru'];
    const refs = [];
    const live = normalizeLocalePrefix(locales, { prefixes: { ru: '/russian' } });
    matchLocalePrefix('/russian/docs', locales, live);
    function populate() {
      for (let i = 0; i < 200; i++) {
        const config = normalizeLocalePrefix(locales, { prefixes: { ru: '/r' + i } });
        matchLocalePrefix('/r' + i + '/docs', locales, config);
        refs.push(new WeakRef(config));
      }
    }
    populate();
    // WeakRefs retain their target until the end of the current job. Yield
    // between collections, and do not dereference them during the GC loop.
    for (let i = 0; i < 8; i++) { await setImmediate(); global.gc(); }
    const retained = refs.filter((ref) => ref.deref() !== undefined).length;
    assert.equal(retained, 0, 'temporary configs retained by the prefix table cache');
    // Both keys of this entry are still live, so it must continue to work.
    assert.deepEqual(matchLocalePrefix('/russian/docs', locales, live), { locale: 'ru', rest: '/docs' });
    assert.deepEqual(locales, ['en', 'ru']);
  `], { encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('normalization enumerates the custom map once, not once per locale', () => {
  const locales = Array.from({ length: 40 }, (_, i) => `en-x-l${i}`);
  const raw = Object.fromEntries(locales.map((locale, i) => [locale, `/language-${i}`]));
  let enumerations = 0;
  const prefixes = new Proxy(raw, {
    ownKeys(target) { enumerations++; return Reflect.ownKeys(target); },
  });
  const normalized = normalizeLocalePrefix(locales, { mode: 'as-needed', prefixes });
  assert.equal(enumerations, 1);
  assert.deepEqual(Object.keys(normalized.prefixes), locales);
  for (let i = 0; i < locales.length; i++) {
    assert.equal(normalized.prefixes[locales[i]], `/language-${i}`);
  }
});

test('normalization preserves canonical aliases, fallback lookup, and first-match precedence', () => {
  const locales = ['en', 'pt-BR', 'zh-Hant', 'ru'];
  const normalized = normalizeLocalePrefix(locales, {
    prefixes: {
      en_US: '/american', // Existing lookup semantics allow a supported parent locale.
      'pt_br': '/brasil',
      'PT-BR': '/ignored-alias',
      'zh-Hant-TW': '/traditional',
      fr: '/unsupported',
    },
  });
  assert.deepEqual(normalized, { mode: 'always', prefixes: {
    en: '/american', 'pt-BR': '/brasil', 'zh-Hant': '/traditional', ru: '/ru',
  } });
  assert.equal(normalizeLocalePrefix(['en-US'], {
    prefixes: { en_US: undefined, 'EN-US': '/later-alias' },
  }).prefixes['en-US'], '/en-US', 'an omitted first alias keeps the default prefix');
  assert.deepEqual(normalizeLocalePrefix(locales, 'never'), { mode: 'never', prefixes: {
    en: '/en', 'pt-BR': '/pt-BR', 'zh-Hant': '/zh-Hant', ru: '/ru',
  } });
});

test('prefix tables remain isolated by both locales and normalized configuration', () => {
  const all = ['en', 'ru'];
  const subset = ['en'];
  const first = normalizeLocalePrefix(all, { prefixes: { ru: '/russian' } });
  const second = normalizeLocalePrefix(all, { prefixes: { ru: '/rus' } });
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(matchLocalePrefix('/russian/docs', all, first), { locale: 'ru', rest: '/docs' });
    assert.equal(matchLocalePrefix('/russian/docs', all, second), null);
    assert.equal(matchLocalePrefix('/russian/docs', subset, first), null);
    assert.deepEqual(matchLocalePrefix('/rus/docs', all, second), { locale: 'ru', rest: '/docs' });
  }
});
