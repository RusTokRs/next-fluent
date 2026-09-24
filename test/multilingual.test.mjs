import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFluentBundle,
  createTranslator,
  createFormatter,
  matchSupportedLocale,
  resolveAcceptLanguage,
  localeLookupCandidates,
  normalizeLocaleTag,
  defineRouting,
  resolveLocalizedPathname,
  createI18nMiddleware,
} from '../dist/index.js';

test('Multilingual Plurals: Arabic 6-form plural rules (zero, one, two, few, many, other)', () => {
  const ftlArabic = `
notifications = { $count ->
    [zero] ليس لديك أي إشعارات
    [one] لديك إشعار واحد
    [two] لديك إشعاران
    [few] لديك { $count } إشعارات
    [many] لديك { $count } إشعاراً
   *[other] لديك { $count } إشعار
}
`;
  const bundle = createFluentBundle('ar', ftlArabic, { useIsolating: false });
  const t = createTranslator(bundle);

  assert.equal(t('notifications', { count: 0 }), 'ليس لديك أي إشعارات');
  assert.equal(t('notifications', { count: 1 }), 'لديك إشعار واحد');
  assert.equal(t('notifications', { count: 2 }), 'لديك إشعاران');
  assert.equal(t('notifications', { count: 3 }), 'لديك 3 إشعارات');
  assert.equal(t('notifications', { count: 11 }), 'لديك 11 إشعاراً');
  assert.equal(t('notifications', { count: 100 }), 'لديك 100 إشعار');
});

test('Multilingual Plurals: Polish 3-form plural rules (one, few, many)', () => {
  const ftlPolish = `
files = { $count ->
    [one] { $count } plik
    [few] { $count } pliki
   *[many] { $count } plików
}
`;
  const bundle = createFluentBundle('pl', ftlPolish, { useIsolating: false });
  const t = createTranslator(bundle);

  assert.equal(t('files', { count: 1 }), '1 plik');
  assert.equal(t('files', { count: 2 }), '2 pliki');
  assert.equal(t('files', { count: 4 }), '4 pliki');
  assert.equal(t('files', { count: 5 }), '5 plików');
  assert.equal(t('files', { count: 21 }), '21 plików');
  assert.equal(t('files', { count: 22 }), '22 pliki');
});

test('Multilingual Plurals: French rules treat 0 as "one"', () => {
  const ftlFrench = `
items = { $count ->
    [one] { $count } message
   *[other] { $count } messages
}
`;
  const bundle = createFluentBundle('fr', ftlFrench, { useIsolating: false });
  const t = createTranslator(bundle);

  // In French CLDR, 0 falls into "one"
  assert.equal(t('items', { count: 0 }), '0 message');
  assert.equal(t('items', { count: 1 }), '1 message');
  assert.equal(t('items', { count: 2 }), '2 messages');
});

test('Multilingual Plurals: East Asian languages (Japanese & Chinese) have single plural category', () => {
  const ftlJapanese = `
items = { $count ->
   *[other] { $count }個のアイテム
}
`;
  const bundle = createFluentBundle('ja', ftlJapanese, { useIsolating: false });
  const t = createTranslator(bundle);

  assert.equal(t('items', { count: 0 }), '0個のアイテム');
  assert.equal(t('items', { count: 1 }), '1個のアイテム');
  assert.equal(t('items', { count: 10 }), '10個のアイテム');
});

test('RTL & BiDi formatting: Arabic and Hebrew preserve direction markers when enabled', () => {
  const ftlArabic = 'greeting = مرحبا يا { $name }!';
  const bundleWithIsolating = createFluentBundle('ar', ftlArabic, { useIsolating: true });
  const tIsolating = createTranslator(bundleWithIsolating);
  const formattedWithBidi = tIsolating('greeting', { name: 'Alex' });

  // BiDi isolation wraps interpolated variables with FSI (\u2068) and PDI (\u2069)
  assert.ok(formattedWithBidi.includes('\u2068'));
  assert.ok(formattedWithBidi.includes('\u2069'));

  // Disabling bidi isolation produces clean plain text
  const bundleNoIsolating = createFluentBundle('ar', ftlArabic, { useIsolating: false });
  const tPlain = createTranslator(bundleNoIsolating);
  assert.equal(tPlain('greeting', { name: 'Alex' }), 'مرحبا يا Alex!');
});

test('Intl Formatter across diverse world locales (number, currency, dateTime, list)', () => {
  // German (de-DE)
  const deFormatter = createFormatter({ locale: 'de-DE', timeZone: 'UTC' });
  const deNum = deFormatter.number(1234567.89);
  assert.ok(deNum.includes(',') || deNum.includes('.')); // German uses comma as decimal separator
  const deCurrency = deFormatter.number(1234.5, { style: 'currency', currency: 'EUR' });
  assert.ok(deCurrency.includes('€'));
  const deList = deFormatter.list(['Apfel', 'Banane', 'Orange']);
  assert.ok(deList.includes('und')); // "Apfel, Banane und Orange"

  // Japanese (ja-JP)
  const jaFormatter = createFormatter({ locale: 'ja-JP', timeZone: 'Asia/Tokyo' });
  const jaCurrency = jaFormatter.number(5000, { style: 'currency', currency: 'JPY' });
  assert.ok(jaCurrency.includes('￥') || jaCurrency.includes('JP'));

  // French (fr-FR)
  const frFormatter = createFormatter({ locale: 'fr-FR', timeZone: 'UTC' });
  const frList = frFormatter.list(['pomme', 'banane', 'orange']);
  assert.ok(frList.includes('et')); // "pomme, banane et orange"

  // Spanish (es-ES)
  const esFormatter = createFormatter({ locale: 'es-ES', timeZone: 'UTC' });
  const esList = esFormatter.list(['manzana', 'plátano', 'naranja']);
  assert.ok(esList.includes(' y ')); // "manzana, plátano y naranja"

  // Arabic (ar-EG)
  const arFormatter = createFormatter({ locale: 'ar-EG', timeZone: 'UTC' });
  const date = new Date('2026-05-15T12:00:00Z');
  const arDate = arFormatter.dateTime(date, { month: 'long', year: 'numeric' });
  assert.ok(arDate.length > 0);
});

test('Structured BCP 47 Candidate Fallbacks for complex regional locales', () => {
  // Chinese Simplified (zh-Hans-CN -> zh-Hans -> zh)
  const zhCandidates = localeLookupCandidates('zh-Hans-CN');
  assert.ok(zhCandidates.includes('zh-Hans'));
  assert.ok(zhCandidates.includes('zh'));

  // Brazilian Portuguese matching pt or pt-BR
  const supportedLocales = ['en', 'pt', 'es', 'de'];
  assert.equal(matchSupportedLocale('pt-BR', supportedLocales), 'pt');

  // Austrian German matching de
  assert.equal(matchSupportedLocale('de-AT', supportedLocales), 'de');

  // Latin American Spanish matching es
  assert.equal(matchSupportedLocale('es-419', supportedLocales), 'es');
});

test('Accept-Language negotiation with diverse world language preferences', () => {
  const available = ['en', 'zh', 'ja', 'ar', 'de', 'fr'];
  
  // Header prioritizing Japanese, then German
  const header1 = 'ja,ja-JP;q=0.9,de;q=0.8,en;q=0.7';
  assert.equal(resolveAcceptLanguage(header1, available), 'ja');

  // Header prioritizing Arabic
  const header2 = 'ar-EG,ar;q=0.9,en-US;q=0.5';
  assert.equal(resolveAcceptLanguage(header2, available), 'ar');

  // Header with Chinese Simplified
  const header3 = 'zh-CN,zh-Hans;q=0.9,zh;q=0.8,en;q=0.7';
  assert.equal(resolveAcceptLanguage(header3, available), 'zh');
});

test('Multilingual Routing & Localized Pathnames with 7 languages', () => {
  const routing = defineRouting({
    locales: ['en', 'de', 'fr', 'es', 'zh', 'ar', 'ja'],
    defaultLocale: 'en',
    localePrefix: 'always',
    pathnames: {
      '/about': {
        en: '/about-us',
        de: '/ueber-uns',
        fr: '/a-propos',
        es: '/sobre-nosotros',
        zh: '/guanyu',
        ar: '/man-nahnu',
        ja: '/gaiyou',
      },
      '/contact': {
        en: '/contact',
        de: '/kontakt',
        fr: '/contactez-nous',
        es: '/contacto',
        zh: '/lianxi',
        ar: '/ittisal',
        ja: '/otoiawase',
      },
    },
  });

  // Check localized pathname generation for all 7 languages
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'en' }, routing), '/en/about-us');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'de' }, routing), '/de/ueber-uns');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'fr' }, routing), '/fr/a-propos');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'es' }, routing), '/es/sobre-nosotros');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'zh' }, routing), '/zh/guanyu');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'ar' }, routing), '/ar/man-nahnu');
  assert.equal(resolveLocalizedPathname({ href: '/about', locale: 'ja' }, routing), '/ja/gaiyou');

  // Check /contact
  assert.equal(resolveLocalizedPathname({ href: '/contact', locale: 'de' }, routing), '/de/kontakt');
  assert.equal(resolveLocalizedPathname({ href: '/contact', locale: 'ar' }, routing), '/ar/ittisal');
});

test('Middleware detects non-Latin / RTL locales from Accept-Language and cookie', async () => {
  const middleware = createI18nMiddleware({
    locales: ['en', 'zh', 'ar', 'de'],
    defaultLocale: 'en',
  });

  // Request with Arabic Accept-Language header
  const reqArabic = {
    url: 'https://example.com/',
    nextUrl: { pathname: '/', search: '' },
    cookies: { get: () => undefined },
    headers: { get: (name) => (name === 'accept-language' ? 'ar-EG,ar;q=0.9' : null) },
  };
  const resArabic = await middleware(reqArabic);
  assert.equal(resArabic.status, 307);
  assert.equal(resArabic.headers.get('location'), 'https://example.com/ar');
  assert.equal(resArabic.headers.get('x-next-locale'), 'ar');

  // Request with Chinese cookie
  const reqChinese = {
    url: 'https://example.com/',
    nextUrl: { pathname: '/', search: '' },
    cookies: {
      get: (name) => (name === 'NEXT_LOCALE' ? { value: 'zh' } : undefined),
    },
    headers: { get: () => null },
  };
  const resChinese = await middleware(reqChinese);
  assert.equal(resChinese.status, 307);
  assert.equal(resChinese.headers.get('location'), 'https://example.com/zh');
  assert.equal(resChinese.headers.get('x-next-locale'), 'zh');
});
